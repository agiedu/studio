
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import NextImage from 'next/image';
import ePub, { type Book as EpubBook, type Rendition } from 'epubjs';
import { GlobalWorkerOptions, getDocument, version as pdfjsVersion } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Loader2, Play, Pause, Smartphone, Cloud as CloudIcon, Star, AlertTriangle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, BookOpen, Settings2, Image as ImageIcon, FileText, ScanText } from 'lucide-react'; // Added ScanText

import { getCloudSpeech, performOCR } from '@/app/actions';
import * as LocalStorageService from '@/lib/localStorageService';
import * as IndexedDBService from '@/lib/indexedDBService';
import type { TTSSettings, TTSVoice, StoredMangaDocument, ActiveMangaDocument } from '@/types';
import { cn } from '@/lib/utils';

const PDF_DEFAULT_SCALE = 1.5;

export default function ReaderPage() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeDoc, setActiveDoc] = useState<ActiveMangaDocument | null>(null);
  const [isLoadingDoc, setIsLoadingDoc] = useState(true);
  const [docErrorMessage, setDocErrorMessage] = useState<string | null>(null);

  // PDF specific state
  const [pdfDocProxy, setPdfDocProxy] = useState<PDFDocumentProxy | null>(null);
  const [currentPdfPageNum, setCurrentPdfPageNum] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfPageImage, setPdfPageImage] = useState<string | null>(null);
  const [isRenderingPdfPage, setIsRenderingPdfPage] = useState(false);
  const [pdfScale, setPdfScale] = useState(PDF_DEFAULT_SCALE);

  // EPUB specific state
  const [epubBook, setEpubBook] = useState<EpubBook | null>(null);
  const [epubRendition, setEpubRendition] = useState<Rendition | null>(null);
  const epubViewerRef = useRef<HTMLDivElement>(null);

  // TXT specific state
  const [txtContent, setTxtContent] = useState<string>("");
  
  // Image specific state
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isPerformingOcr, setIsPerformingOcr] = useState(false);

  const [currentTextForTTS, setCurrentTextForTTS] = useState<string>("");

  // TTS state
  const [ttsSettings, setTtsSettings] = useState<TTSSettings>(LocalStorageService.defaultTTSSettings);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);
  const [isLoadingTTS, setIsLoadingTTS] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [sentenceSegments, setSentenceSegments] = useState<string[]>([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number>(-1);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && !GlobalWorkerOptions.workerSrc) {
      GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
    }
  }, []);

  const resetReaderState = useCallback(() => {
    setActiveDoc(null);
    setPdfDocProxy(null);
    setCurrentPdfPageNum(1);
    setPdfTotalPages(0);
    setPdfPageImage(null);
    
    if (epubRendition) {
        epubRendition.destroy();
        setEpubRendition(null);
    }
    setEpubBook(null);
    if (epubViewerRef.current) epubViewerRef.current.innerHTML = '';
    
    setTxtContent("");
    if (imageSrc) {
      URL.revokeObjectURL(imageSrc); // Revoke old image object URL
      setImageSrc(null);
    }
    setCurrentTextForTTS("");
    setDocErrorMessage(null);
    setIsLoadingDoc(true); // Set loading true when resetting
  }, [imageSrc, epubRendition]); // Add epubRendition to dependencies

  useEffect(() => {
    const docId = searchParams.get('docId');
    if (!docId) {
      setDocErrorMessage("No document ID provided. Please select a document from the Library.");
      setIsLoadingDoc(false);
      return;
    }

    resetReaderState(); // Reset state before loading a new document

    IndexedDBService.getDocumentById(docId)
      .then(async (doc) => {
        if (!doc) {
          setDocErrorMessage(`Document with ID "${docId}" not found.`);
          setIsLoadingDoc(false);
          return;
        }
        setActiveDoc(doc as ActiveMangaDocument);
        await IndexedDBService.saveLastActiveDocId(docId);

        if (doc.type === 'pdf') {
          try {
            const pdf = await getDocument({ data: doc.fileData.slice(0) }).promise;
            setPdfDocProxy(pdf);
            setPdfTotalPages(pdf.numPages);
            setCurrentPdfPageNum(LocalStorageService.loadCurrentPdfPageIndexForDoc(doc.id) || 1);
          } catch (e: any) {
            console.error("Error loading PDF:", e);
            setDocErrorMessage(`Failed to load PDF: ${e.message}`);
            setCurrentTextForTTS(`Failed to load PDF: ${e.message}`);
          }
        } else if (doc.type === 'epub') {
          if (!epubViewerRef.current) {
            setDocErrorMessage("EPUB viewer element not ready.");
            setIsLoadingDoc(false);
            return;
          }
          epubViewerRef.current.innerHTML = ''; // Clear previous EPUB
          try {
            const bookInstance = ePub(doc.fileData);
            setEpubBook(bookInstance);
            
            await bookInstance.ready; // Wait for book metadata to be parsed

            const renditionInstance = bookInstance.renderTo(epubViewerRef.current, {
              width: "100%",
              height: "100%",
              flow: "paginated",
              spread: "auto",
            });
            setEpubRendition(renditionInstance);
            
            await renditionInstance.display(); // Display the first section

            renditionInstance.on('displayed', async (section: any) => {
              try {
                if (!bookInstance.spine || !renditionInstance.manager || !renditionInstance.currentLocation()) {
                  setCurrentTextForTTS("EPUB section loaded, but text extraction might be incomplete.");
                  return;
                }
                const currentLocation = renditionInstance.currentLocation();
                if (currentLocation && currentLocation.start && currentLocation.start.cfi) {
                  const range = await bookInstance.getRange(currentLocation.start.cfi);
                  if (range && range.toString()) {
                    setCurrentTextForTTS(range.toString().replace(/\s+/g, ' ').trim());
                  } else {
                    let text = "";
                    const iframe = epubViewerRef.current?.querySelector('iframe');
                    if (iframe && iframe.contentDocument) {
                      const body = iframe.contentDocument.body;
                      if (body) text = body.innerText || body.textContent || "";
                    }
                    setCurrentTextForTTS(text.replace(/\s+/g, ' ').trim() || "Could not extract text from this EPUB section.");
                  }
                } else {
                  setCurrentTextForTTS("Could not determine current location in EPUB to extract text.");
                }
              } catch (textExtractError: any) {
                console.error("Error extracting text from EPUB section:", textExtractError);
                setCurrentTextForTTS(`Error extracting text: ${textExtractError.message}`);
              }
            });

          } catch (e: any) {
            console.error("Error loading EPUB:", e);
            if (e.message && e.message.toLowerCase().includes("uncompressed data size mismatch")) {
              setDocErrorMessage("Failed to load EPUB: The file might be corrupted or not a valid EPUB archive. (Uncompressed data size mismatch)");
              setCurrentTextForTTS("Failed to load EPUB: The file might be corrupted. (Uncompressed data size mismatch)");
            } else {
              setDocErrorMessage(`Failed to load EPUB: ${e.message || "Unknown error"}`);
              setCurrentTextForTTS(`Failed to load EPUB: ${e.message || "Unknown error"}`);
            }
          }
        } else if (doc.type === 'txt') {
          const decoder = new TextDecoder();
          const text = decoder.decode(doc.fileData);
          setTxtContent(text);
          setCurrentTextForTTS(text);
        } else if (doc.type === 'image') {
          const blob = new Blob([doc.fileData], { type: doc.originalType });
          const newImageSrc = URL.createObjectURL(blob);
          setImageSrc(newImageSrc); // Set new image src
          setCurrentTextForTTS(doc.extractedText || "Image loaded. Perform OCR to extract text for reading aloud.");
        } else if (doc.type === 'mobi') {
          setDocErrorMessage("MOBI file format is not directly supported for reading. Please convert it to EPUB or PDF.");
          setCurrentTextForTTS("MOBI files cannot be read directly.");
        }
        setIsLoadingDoc(false);
      })
      .catch(err => {
        console.error("Error loading document from IndexedDB:", err);
        setDocErrorMessage(`Error loading document: ${err.message}`);
        setCurrentTextForTTS(`Error loading document: ${err.message}`);
        setIsLoadingDoc(false);
      });
      
    return () => {
      // Cleanup for the current document when docId changes or component unmounts
      if (imageSrc) URL.revokeObjectURL(imageSrc); 
      // epubRendition.destroy() is handled in resetReaderState
    };

  }, [searchParams, toast, resetReaderState]); // Added resetReaderState
  
  useEffect(() => {
    if (activeDoc?.type === 'pdf' && pdfDocProxy && currentPdfPageNum > 0 && currentPdfPageNum <= pdfTotalPages) {
      setIsRenderingPdfPage(true);
      setPdfPageImage(null);
      setCurrentTextForTTS("Loading PDF page...");
      LocalStorageService.saveCurrentPdfPageIndexForDoc(activeDoc.id, currentPdfPageNum);

      pdfDocProxy.getPage(currentPdfPageNum).then(async (page) => {
        const viewport = page.getViewport({ scale: pdfScale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        if (context) {
          await page.render({ canvasContext: context, viewport }).promise;
          setPdfPageImage(canvas.toDataURL());
        }
        
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim();
        setCurrentTextForTTS(pageText || "No text content found on this PDF page.");

      }).catch(e => {
        console.error("Error rendering PDF page:", e);
        setPdfPageImage(null);
        setCurrentTextForTTS(`Error rendering PDF page ${currentPdfPageNum}: ${e.message}`);
      }).finally(() => {
        setIsRenderingPdfPage(false);
      });
    }
  }, [pdfDocProxy, currentPdfPageNum, pdfTotalPages, pdfScale, activeDoc]);

  const handlePerformOcrForImage = async () => {
    if (activeDoc?.type === 'image' && activeDoc.fileData) { // Ensure fileData exists
      setIsPerformingOcr(true);
      setCurrentTextForTTS("Performing OCR...");
      try {
        const base64DataUrl = await IndexedDBService.arrayBufferToBase64DataURL(activeDoc.fileData, activeDoc.originalType);
        const result = await performOCR(base64DataUrl);
        if ('extractedText' in result) {
          setCurrentTextForTTS(result.extractedText || "OCR completed, but no text found.");
          const updatedDoc = { ...activeDoc, extractedText: result.extractedText };
          await IndexedDBService.saveDocument(updatedDoc); // Save OCR text
          setActiveDoc(updatedDoc); // Update local state
        } else {
          setCurrentTextForTTS(`OCR Error: ${result.error}`);
          toast({ variant: "destructive", title: "OCR Error", description: result.error });
        }
      } catch (e: any) {
        setCurrentTextForTTS(`OCR failed: ${e.message}`);
        toast({ variant: "destructive", title: "OCR Failed", description: e.message });
      } finally {
        setIsPerformingOcr(false);
      }
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setTtsSettings(LocalStorageService.loadTTSSettings());
    }
  }, []);

  const stopSpeech = useCallback((resetUIState = true) => {
    if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    } else if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      try { if (audioPlayerRef.current.src && audioPlayerRef.current.readyState >= HTMLMediaElement.HAVE_METADATA) audioPlayerRef.current.currentTime = 0; } catch (e) { /* ignore */ }
    }
    if (utteranceRef.current) {
      utteranceRef.current.onend = null; utteranceRef.current.onboundary = null; utteranceRef.current.onerror = null; utteranceRef.current = null;
    }
    if(resetUIState) {
      setIsSpeaking(false); setIsPaused(false); setIsLoadingTTS(false); setCurrentSentenceIndex(-1); setSentenceSegments([]);
    }
  }, [ttsSettings.type]);

  const populateVoiceList = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const voices = window.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService, default: v.default }));
      setAvailableVoices(voices);
      const currentSettings = LocalStorageService.loadTTSSettings(); // load fresh
      if (!currentSettings.voiceURI && voices.length > 0) {
        const defaultVoice = voices.find(v => v.lang === currentSettings.language && v.default) || voices.find(v => v.lang === currentSettings.language) || voices.find(v => v.default && v.lang.startsWith(currentSettings.language.split('-')[0])) || voices.find(v => v.default) || voices[0];
        if (defaultVoice) {
            setTtsSettings(prev => ({...prev, voiceURI: defaultVoice.voiceURI, language: defaultVoice.lang }));
        }
      } else {
         // Ensure current settings are fully applied, including potential updates from defaultTTSSettings
         setTtsSettings(prev => ({...LocalStorageService.defaultTTSSettings, ...currentSettings, type: currentSettings.type || 'local'}));
      }
    }
  }, []);

  useEffect(() => {
    populateVoiceList();
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = populateVoiceList;
    }
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
      stopSpeech(true);
    };
  }, [populateVoiceList, stopSpeech]);

  useEffect(() => { LocalStorageService.saveTTSSettings(ttsSettings); }, [ttsSettings]);
  
  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;
    const handleAudioEnded = () => stopSpeech(true);
    const handleAudioPlaying = () => { if (ttsSettings.type === 'cloud' && isSpeaking) setIsLoadingTTS(false); };
    const handleAudioError = () => { toast({variant: "destructive", title: "Audio Error", description: "Failed to play audio."}); stopSpeech(true); };
    player.addEventListener('ended', handleAudioEnded); player.addEventListener('playing', handleAudioPlaying); player.addEventListener('error', handleAudioError);
    return () => {
      player.removeEventListener('ended', handleAudioEnded); player.removeEventListener('playing', handleAudioPlaying); player.removeEventListener('error', handleAudioError);
      if (player.src && !player.paused) player.pause(); player.src = ""; if(audioPlayerRef.current === player) audioPlayerRef.current = null;
    };
  }, [ttsSettings.type, isSpeaking, toast, stopSpeech]);

  const playPauseSpeech = async () => {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    const selectedTextFromSelection = selection?.toString().trim();
    const effectiveTextToRead = selectedTextFromSelection || currentTextForTTS;

    const invalidMessages = [
      "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", 
      "Image loaded. Perform OCR", "No text content found", "Could not extract text",
      "Could not determine current location", "EPUB viewer element not", "EPUB section loaded, but text extraction"
    ];

    if (!effectiveTextToRead || invalidMessages.some(msg => effectiveTextToRead.startsWith(msg))) {
      toast({ variant: "destructive", title: "No Valid Text", description: "No valid text available to read, or document is still loading/processing, or an error occurred." });
      return;
    }

    if (isSpeaking) {
      if (isPaused) {
        if (ttsSettings.type === 'local' && utteranceRef.current && window.speechSynthesis?.paused) { window.speechSynthesis.resume(); setIsPaused(false); }
        else if (ttsSettings.type === 'cloud' && audioPlayerRef.current?.paused) { audioPlayerRef.current.play().catch(() => stopSpeech(true)); setIsPaused(false); }
      } else {
        if (ttsSettings.type === 'local' && utteranceRef.current && window.speechSynthesis?.speaking) { window.speechSynthesis.pause(); setIsPaused(true); }
        else if (ttsSettings.type === 'cloud' && audioPlayerRef.current && !audioPlayerRef.current.paused) { audioPlayerRef.current.pause(); setIsPaused(true); }
      }
    } else {
      stopSpeech(false); setIsLoadingTTS(true); setIsSpeaking(true); setIsPaused(false);
      if (ttsSettings.type === 'local') {
        if (!window.speechSynthesis) { toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." }); stopSpeech(true); return; }
        
        const utterance = new SpeechSynthesisUtterance(effectiveTextToRead);
        utterance.lang = ttsSettings.language; utterance.pitch = ttsSettings.pitch; utterance.rate = ttsSettings.rate;
        const voice = availableVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
        if (voice && window.speechSynthesis.getVoices().find(v => v.voiceURI === voice.voiceURI)) {
             utterance.voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === voice.voiceURI);
        } else if (availableVoices.length > 0) {
            // Fallback logic for voice if selected one is not found (e.g. after browser restart)
            const fallbackVoice = availableVoices.find(v => v.lang === ttsSettings.language && v.default) || availableVoices.find(v => v.lang === ttsSettings.language) || availableVoices.find(v => v.default && v.lang.startsWith(ttsSettings.language.split('-')[0])) || availableVoices[0];
            if (fallbackVoice && window.speechSynthesis.getVoices().find(v => v.voiceURI === fallbackVoice.voiceURI)) {
                utterance.voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === fallbackVoice.voiceURI);
                setTtsSettings(prev => ({ ...prev, voiceURI: fallbackVoice.voiceURI, language: fallbackVoice.lang })); // Update settings
            }
        }

        const segments = effectiveTextToRead.match(/[^.!?]+[.!?]*|[^.!?]+/g) || []; setSentenceSegments(segments); setCurrentSentenceIndex(0);
        utterance.onboundary = (event) => { if(utteranceRef.current !== utterance) return; let c = 0; for (let i = 0; i < segments.length; i++) { if (event.charIndex >= c && event.charIndex < c + segments[i].length) { setCurrentSentenceIndex(i); break; } c += segments[i].length; }};
        utterance.onend = () => { if(utteranceRef.current === utterance) stopSpeech(true); };
        utterance.onerror = (event) => { if(utteranceRef.current === utterance) { toast({ variant: "destructive", title: "TTS Error", description: event.error || "Failed." }); stopSpeech(true); }};
        utteranceRef.current = utterance; window.speechSynthesis.speak(utterance); setIsLoadingTTS(false);
      } else {
        setSentenceSegments([]); setCurrentSentenceIndex(-1);
        try {
          const result = await getCloudSpeech(effectiveTextToRead, ttsSettings.language);
          if ('audioUrl' in result && audioPlayerRef.current) { audioPlayerRef.current.src = result.audioUrl; await audioPlayerRef.current.play(); }
          else if ('error' in result) { toast({ variant: "destructive", title: "Cloud TTS Error", description: result.error }); stopSpeech(true); }
        } catch (e: any) { toast({ variant: "destructive", title: "Cloud TTS Failed", description: e.message }); stopSpeech(true); }
      }
    }
  };

  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    stopSpeech(true);
    setTtsSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      if (key === 'language' && newSettings.type === 'local' && availableVoices.length > 0) {
        const suitableVoice = availableVoices.find(v => v.lang === value && v.default) || availableVoices.find(v => v.lang === value) || availableVoices.find(v => v.lang && v.lang.startsWith((value as string).split('-')[0]) && v.default) || availableVoices.find(v => v.lang && v.lang.startsWith((value as string).split('-')[0]));
        newSettings.voiceURI = suitableVoice ? suitableVoice.voiceURI : undefined;
        if(suitableVoice) newSettings.language = suitableVoice.lang; // also update language to match voice's exact lang
      } else if (key === 'type' && value === 'cloud') {
        newSettings.voiceURI = undefined; // Cloud doesn't use local voice URI
      }
      return newSettings;
    });
  };

  const handleFavoriteSelection = () => {
    const selection = window.getSelection()?.toString().trim() || currentTextForTTS;
     const invalidMessages = [
      "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", 
      "Image loaded. Perform OCR", "No text content found", "Could not extract text",
      "Could not determine current location", "EPUB viewer element not", "EPUB section loaded, but text extraction"
    ];
    if (selection && activeDoc && !invalidMessages.some(msg => selection.startsWith(msg))) {
      LocalStorageService.addFavoriteItem({ id: Date.now().toString(), text: selection, sourceDocumentId: activeDoc.id, sourceDocumentName: activeDoc.title, createdAt: Date.now() });
      toast({ title: "Favorited!", description: `"${selection.substring(0,50)}..." added.`});
    } else {
      toast({ variant: "destructive", title: "No Valid Text", description: "Ensure valid text is available to favorite." });
    }
  };

  const navigatePdf = (direction: 'prev' | 'next') => {
    if (!pdfDocProxy || isRenderingPdfPage) return;
    let newPage = currentPdfPageNum;
    if (direction === 'prev' && currentPdfPageNum > 1) newPage--;
    if (direction === 'next' && currentPdfPageNum < pdfTotalPages) newPage++;
    if (newPage !== currentPdfPageNum) { stopSpeech(true); setCurrentPdfPageNum(newPage); }
  };
  const handlePdfScaleChange = (newScale: number) => {
    stopSpeech(true); // Stop speech if scale changes, as text might reflow
    setPdfScale(newScale);
  };


  const navigateEpub = (direction: 'prev' | 'next') => {
    if (!epubRendition) return;
    stopSpeech(true);
    if (direction === 'prev') epubRendition.prev(); else epubRendition.next();
  };

  const getButtonState = () => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const invalidMessages = [ /* ... as defined in playPauseSpeech ... */];
    const effectiveText = selectedText || currentTextForTTS;
    const canPlay = !!(effectiveText && !invalidMessages.some(msg => effectiveText.startsWith(msg)));
    
    if (isLoadingTTS) return { text: "Loading...", icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, disabled: true };
    if (isSpeaking) return isPaused ? { text: "Resume", icon: <Play className="mr-1 h-4 w-4" />, disabled: false } : { text: "Pause", icon: <Pause className="mr-1 h-4 w-4" />, disabled: false };
    return { text: selectedText ? "Play Selected" : "Play Text", icon: <Play className="mr-1 h-4 w-4" />, disabled: !canPlay };
  };
  const buttonState = getButtonState();

  if (isLoadingDoc) {
    return <div className="flex items-center justify-center h-full flex-grow"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-lg">Loading document...</p></div>;
  }
  
  if (docErrorMessage && !activeDoc) { // Show error if doc failed to load and no activeDoc
    return <div className="flex flex-col items-center justify-center h-full flex-grow p-4 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-xl font-semibold mb-2">Error Loading Document</h2>
        <p className="text-muted-foreground mb-4">{docErrorMessage}</p>
        <Button onClick={() => router.push('/library')}>Go to Library</Button>
    </div>;
  }
  
  // If there's an error message but we have an activeDoc, it means an error occurred AFTER initial load (e.g., EPUB processing)
  // We can display this error within the reader view.

  return (
    <div className="flex flex-col lg:flex-row w-full h-[calc(100vh-4rem)]">
      <div className="flex-grow overflow-y-auto bg-muted/20 p-2 md:p-4 relative">
        {docErrorMessage && activeDoc && ( // Display error overlay if doc is active but error occurred
            <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center z-10 p-4">
                <AlertTriangle className="h-10 w-10 text-destructive mb-3" />
                <p className="text-destructive font-medium text-center mb-1">Document Error</p>
                <p className="text-muted-foreground text-sm text-center mb-3">{docErrorMessage}</p>
                <Button onClick={() => { setDocErrorMessage(null); /* Optionally try to reload or reset part of the doc state */ }}>Dismiss</Button>
            </div>
        )}

        {activeDoc?.type === 'pdf' && (
          <div className="flex flex-col items-center">
            {isRenderingPdfPage && !pdfPageImage && <Loader2 className="h-10 w-10 animate-spin my-8" />}
            {pdfPageImage && <NextImage src={pdfPageImage} alt={`Page ${currentPdfPageNum}`} width={0} height={0} sizes="100vw" style={{ width: 'auto', height: 'auto', maxHeight: 'calc(100vh - 12rem)', maxWidth: '100%', objectFit: 'contain' }} className="shadow-lg border rounded-md" />}
            {!pdfPageImage && !isRenderingPdfPage && !docErrorMessage && <div className="my-8 text-muted-foreground">{(pdfDocProxy && pdfTotalPages > 0) ? `Rendering page ${currentPdfPageNum}...` : 'No PDF page to display.'}</div>}
          </div>
        )}
        {activeDoc?.type === 'epub' && (
          <div ref={epubViewerRef} className="w-full h-full epub-viewer-container bg-background rounded-md shadow-inner">
            {!epubRendition && !docErrorMessage && <Loader2 className="h-10 w-10 animate-spin m-auto" />}
          </div>
        )}
        {activeDoc?.type === 'txt' && (
          <pre className="whitespace-pre-wrap p-4 bg-background rounded-md shadow-inner text-sm font-mono h-full overflow-y-auto select-text">{txtContent}</pre>
        )}
        {activeDoc?.type === 'image' && imageSrc && (
            <div className="flex flex-col items-center">
                <NextImage src={imageSrc} alt={activeDoc.title || 'Uploaded Image'} width={800} height={600} style={{objectFit: 'contain'}} className="max-w-full max-h-[calc(100vh-15rem)] shadow-lg border rounded-md" />
                {(!activeDoc.extractedText || activeDoc.extractedText === "Image loaded. Perform OCR to extract text for reading aloud.") &&
                    <Button onClick={handlePerformOcrForImage} disabled={isPerformingOcr} className="mt-3">
                        {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR
                    </Button>
                }
            </div>
        )}
         {activeDoc?.type === 'mobi' && (
           <div className="p-4 bg-background rounded-md shadow-inner text-center h-full flex flex-col justify-center items-center">
             <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2"/>
             <p className="font-semibold">MOBI File Format Not Supported</p>
             <p className="text-sm text-muted-foreground">Reading MOBI files directly is not supported in this reader. Please convert your MOBI file to EPUB or PDF format using an external tool and upload it again.</p>
           </div>
         )}

        { (activeDoc?.type === 'pdf' || activeDoc?.type === 'epub' || activeDoc?.type === 'image' || activeDoc?.type === 'txt') && currentTextForTTS && !docErrorMessage &&
            <Card className="mt-4 sticky bottom-2 bg-background/90 backdrop-blur-sm shadow-md">
                <CardHeader className="pb-1 pt-3">
                    <CardTitle className="text-sm flex items-center"><FileText className="mr-2 h-4 w-4"/> Current Text for TTS</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                    <textarea
                        readOnly
                        value={currentTextForTTS}
                        className="w-full h-20 p-2 border rounded-md bg-muted/30 text-xs select-text"
                        placeholder="Text for TTS will appear here..."
                    />
                </CardContent>
            </Card>
        }
      </div>

      <div className="w-full lg:w-80 xl:w-96 p-3 border-l bg-background flex-shrink-0 overflow-y-auto space-y-4">
        <Card>
            <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-base truncate flex items-center gap-1">
                    <BookOpen className="h-5 w-5 text-primary"/> {activeDoc?.title || "No Document Loaded"}
                </CardTitle>
                {activeDoc && <CardDescription className="text-xs">Type: {activeDoc.type.toUpperCase()}{activeDoc.type === 'pdf' && pdfTotalPages > 0 ? `, ${pdfTotalPages} pages` : ''}</CardDescription>}
                 {!activeDoc && !isLoadingDoc && <CardDescription className="text-xs text-destructive">No document is currently loaded or an error occurred.</CardDescription>}
            </CardHeader>
        </Card>
        
        {(activeDoc?.type === 'pdf' && pdfTotalPages > 0) && (
          <Card>
            <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">PDF Navigation & View</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-0">
              <div className="flex items-center justify-between">
                <Button onClick={() => navigatePdf('prev')} disabled={currentPdfPageNum <= 1 || isRenderingPdfPage} size="sm" variant="outline"><ChevronLeft /> Prev</Button>
                <span className="text-sm tabular-nums"> {currentPdfPageNum} / {pdfTotalPages}</span>
                <Button onClick={() => navigatePdf('next')} disabled={currentPdfPageNum >= pdfTotalPages || isRenderingPdfPage} size="sm" variant="outline">Next <ChevronRight /></Button>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => handlePdfScaleChange(pdfScale - 0.25)} size="icon" variant="outline" className="h-7 w-7" disabled={isRenderingPdfPage || pdfScale <= 0.5}><ZoomOut className="h-4 w-4"/></Button>
                <Slider value={[pdfScale]} min={0.5} max={3} step={0.25} onValueChange={([val]) => handlePdfScaleChange(val)} disabled={isRenderingPdfPage} />
                <Button onClick={() => handlePdfScaleChange(pdfScale + 0.25)} size="icon" variant="outline" className="h-7 w-7" disabled={isRenderingPdfPage || pdfScale >=3}><ZoomIn className="h-4 w-4"/></Button>
              </div>
            </CardContent>
          </Card>
        )}
        {activeDoc?.type === 'epub' && epubRendition && (
          <Card>
            <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">EPUB Navigation</CardTitle></CardHeader>
            <CardContent className="flex items-center justify-between pt-0">
              <Button onClick={() => navigateEpub('prev')} size="sm" variant="outline"><ChevronLeft /> Previous</Button>
              <Button onClick={() => navigateEpub('next')} size="sm" variant="outline">Next <ChevronRight /></Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm flex items-center gap-1"><Settings2 className="h-4 w-4"/> Text-to-Speech</CardTitle></CardHeader>
          <CardContent className="space-y-2 pt-0">
            <div>
              <Label htmlFor="tts-engine" className="text-xs">Engine</Label>
              <Select value={ttsSettings.type} onValueChange={(v) => handleSettingChange('type', v as 'local' | 'cloud')} disabled={(isSpeaking && !isPaused)}>
                <SelectTrigger id="tts-engine" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="local"><div className="flex items-center gap-1 text-xs"><Smartphone className="h-3 w-3"/>Local</div></SelectItem><SelectItem value="cloud"><div className="flex items-center gap-1 text-xs"><CloudIcon className="h-3 w-3"/>Cloud</div></SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tts-language" className="text-xs">Language</Label>
              <Input id="tts-language" className="h-9 text-xs" value={ttsSettings.language} onChange={(e) => handleSettingChange('language', e.target.value)} disabled={(isSpeaking && !isPaused) || (ttsSettings.type === 'local' && availableVoices.length === 0)} />
            </div>
            {ttsSettings.type === 'local' && (
              <div>
                <Label htmlFor="tts-voice" className="text-xs">Voice (Local)</Label>
                <Select value={ttsSettings.voiceURI || ""} onValueChange={(v) => handleSettingChange('voiceURI', v)} disabled={(isSpeaking && !isPaused) || availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0}>
                  <SelectTrigger id="tts-voice" className="h-9 text-xs"><SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No voices available"} /></SelectTrigger>
                  <SelectContent className="max-h-48">
                    {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).map(v => (<SelectItem key={v.voiceURI || v.name} value={v.voiceURI} className="text-xs">{v.name} ({v.lang})</SelectItem>))}
                    {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (<SelectItem value="no-voice-reader" disabled>{availableVoices.length > 0 ? "No voices for language" : "No local voices"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1"><Label htmlFor="tts-rate" className="text-xs">Rate: {ttsSettings.rate.toFixed(1)}</Label><Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={(isSpeaking && !isPaused)}/></div>
            <div className="space-y-1"><Label htmlFor="tts-pitch" className="text-xs">Pitch: {ttsSettings.pitch.toFixed(1)}</Label><Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={(isSpeaking && !isPaused)}/></div>
            <Button onClick={playPauseSpeech} disabled={buttonState.disabled || !activeDoc} variant={isSpeaking && !isPaused ? "outline" : "default"} className="w-full h-9 text-sm">{buttonState.icon} {buttonState.text}</Button>
            <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="w-full mt-2" disabled={!activeDoc}><Star className="mr-2 h-4 w-4" /> Favorite Text/Selection</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

