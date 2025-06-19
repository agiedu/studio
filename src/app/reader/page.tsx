
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import NextImage from 'next/image';
import ePub, { type Book as EpubBook, type Rendition } from 'epubjs';
import { GlobalWorkerOptions, getDocument, version as pdfjsVersion } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';

import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Loader2, Play, Pause, Smartphone, Cloud as CloudIcon, Info, Star, AlertTriangle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, BookOpen, Settings2, Image as ImageIcon, FileText } from 'lucide-react';

import { getCloudSpeech, performOCR } from '@/app/actions';
import * as LocalStorageService from '@/lib/localStorageService';
import * as IndexedDBService from '@/lib/indexedDBService';
import type { TTSSettings, TTSVoice, FavoriteItem, StoredMangaDocument, ActiveMangaDocument } from '@/types';
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
  const [currentPdfPageNum, setCurrentPdfPageNum] = useState(1); // 1-based for display
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


  // Shared state for text content for TTS/display
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

  // Setup PDF.js worker
  useEffect(() => {
    if (typeof window !== 'undefined' && !GlobalWorkerOptions.workerSrc) {
      GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
    }
  }, []);

  const resetReaderState = () => {
    setActiveDoc(null);
    setPdfDocProxy(null);
    setCurrentPdfPageNum(1);
    setPdfTotalPages(0);
    setPdfPageImage(null);
    setEpubBook(null);
    if (epubRendition) {
        epubRendition.destroy();
        setEpubRendition(null);
    }
    if (epubViewerRef.current) epubViewerRef.current.innerHTML = '';
    setTxtContent("");
    setImageSrc(null);
    setCurrentTextForTTS("");
    setDocErrorMessage(null);
  };

  // Load document from IndexedDB
  useEffect(() => {
    const docId = searchParams.get('docId');
    if (!docId) {
      setDocErrorMessage("No document ID provided. Please select a document from the Library.");
      setIsLoadingDoc(false);
      return;
    }

    setIsLoadingDoc(true);
    resetReaderState(); // Reset before loading new doc

    IndexedDBService.getDocumentById(docId)
      .then(async (doc) => {
        if (!doc) {
          setDocErrorMessage(`Document with ID "${docId}" not found.`);
          setIsLoadingDoc(false);
          return;
        }
        setActiveDoc(doc as ActiveMangaDocument); // Cast for now
        await IndexedDBService.saveLastActiveDocId(docId);

        // Handle different document types
        if (doc.type === 'pdf') {
          try {
            const pdf = await getDocument({ data: doc.fileData.slice(0) }).promise;
            setPdfDocProxy(pdf);
            setPdfTotalPages(pdf.numPages);
            setCurrentPdfPageNum(LocalStorageService.loadCurrentPdfPageIndexForDoc(doc.id) || 1); // Load last page or default to 1
          } catch (e: any) {
            console.error("Error loading PDF:", e);
            setDocErrorMessage(`Failed to load PDF: ${e.message}`);
            setCurrentTextForTTS(`Failed to load PDF: ${e.message}`);
          }
        } else if (doc.type === 'epub') {
          const book = ePub(doc.fileData);
          setEpubBook(book);
          if (epubViewerRef.current) {
            const rendition = book.renderTo(epubViewerRef.current, {
              width: "100%",
              height: "100%",
              flow: "paginated", // or "scrolled-doc"
              spread: "auto",
            });
            setEpubRendition(rendition);
            rendition.display();
            rendition.on('displayed', (section: any) => {
              // Extract text from current section for TTS
              rendition.start(); // Ensure content is loaded
              const currentSection = book.rendition.currentLocation();
              if (currentSection && currentSection.start && currentSection.start.cfi) {
                  book.getRange(currentSection.start.cfi).then(range => {
                      if(range && range.toString()){
                          setCurrentTextForTTS(range.toString().replace(/\s+/g, ' ').trim());
                      } else {
                          // Fallback: try to get text from visible elements
                          let text = "";
                          const iframe = epubViewerRef.current?.querySelector('iframe');
                          if (iframe && iframe.contentDocument) {
                              const body = iframe.contentDocument.body;
                              if (body) text = body.innerText || body.textContent || "";
                          }
                          setCurrentTextForTTS(text.replace(/\s+/g, ' ').trim());
                      }
                  }).catch(() => setCurrentTextForTTS("Could not extract text from EPUB section."));
              }
            });
          }
        } else if (doc.type === 'txt') {
          const decoder = new TextDecoder();
          const text = decoder.decode(doc.fileData);
          setTxtContent(text);
          setCurrentTextForTTS(text);
        } else if (doc.type === 'image') {
          const blob = new Blob([doc.fileData], { type: doc.originalType });
          setImageSrc(URL.createObjectURL(blob));
          setCurrentTextForTTS(doc.extractedText || "Image loaded. Perform OCR to extract text for reading aloud.");
          if (!doc.extractedText) {
            // Optionally auto-trigger OCR or provide a button
          }
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
      
      return () => { // Cleanup when docId changes or component unmounts
        if (imageSrc) URL.revokeObjectURL(imageSrc);
        if (epubRendition) epubRendition.destroy();
      }

  }, [searchParams, toast]);
  
  // Render PDF page when currentPdfPageNum or pdfDocProxy changes
  useEffect(() => {
    if (activeDoc?.type === 'pdf' && pdfDocProxy && currentPdfPageNum > 0 && currentPdfPageNum <= pdfTotalPages) {
      setIsRenderingPdfPage(true);
      setPdfPageImage(null); // Clear previous page image
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
        
        // Extract text content
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
    if (activeDoc?.type === 'image' && imageSrc) {
      setIsPerformingOcr(true);
      setCurrentTextForTTS("Performing OCR...");
      try {
        const base64DataUrl = await IndexedDBService.arrayBufferToBase64DataURL(activeDoc.fileData, activeDoc.originalType);
        const result = await performOCR(base64DataUrl);
        if ('extractedText' in result) {
          setCurrentTextForTTS(result.extractedText || "OCR completed, but no text found.");
          // Optionally save OCR text back to IndexedDB
          const updatedDoc = { ...activeDoc, extractedText: result.extractedText };
          await IndexedDBService.saveDocument(updatedDoc);
          setActiveDoc(updatedDoc);
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


  // TTS related useEffects and functions (similar to previous implementation, adapted for currentTextForTTS)
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
      try { if (audioPlayerRef.current.src) audioPlayerRef.current.currentTime = 0; } catch (e) { /* ignore */ }
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
      const currentSettings = LocalStorageService.loadTTSSettings();
      if (!currentSettings.voiceURI && voices.length > 0) {
        const defaultVoice = voices.find(v => v.lang === currentSettings.language && v.default) || voices.find(v => v.lang === currentSettings.language) || voices.find(v => v.default) || voices[0];
        if (defaultVoice) setTtsSettings(prev => ({...prev, voiceURI: defaultVoice.voiceURI, language: defaultVoice.lang }));
      } else setTtsSettings(currentSettings);
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
    const selectedTextFromSelection = window.getSelection()?.toString().trim();
    const effectiveTextToRead = selectedTextFromSelection || currentTextForTTS;

    if (!effectiveTextToRead || effectiveTextToRead.startsWith("Error:") || effectiveTextToRead.startsWith("Failed to load") || effectiveTextToRead.startsWith("Loading PDF page...") || effectiveTextToRead.startsWith("MOBI files cannot") || effectiveTextToRead.startsWith("Image loaded. Perform OCR")) {
      toast({ variant: "destructive", title: "No Valid Text", description: "No valid text available to read or document is still loading/processing." });
      return;
    }

    if (isSpeaking) { // Pause or Resume
      if (isPaused) { // Resume
        if (ttsSettings.type === 'local' && utteranceRef.current && window.speechSynthesis.paused) { window.speechSynthesis.resume(); setIsPaused(false); }
        else if (ttsSettings.type === 'cloud' && audioPlayerRef.current?.paused) { audioPlayerRef.current.play().catch(() => stopSpeech(true)); setIsPaused(false); }
      } else { // Pause
        if (ttsSettings.type === 'local' && utteranceRef.current) { window.speechSynthesis.pause(); setIsPaused(true); }
        else if (ttsSettings.type === 'cloud' && audioPlayerRef.current && !audioPlayerRef.current.paused) { audioPlayerRef.current.pause(); setIsPaused(true); }
      }
    } else { // Start new speech
      stopSpeech(false); setIsLoadingTTS(true); setIsSpeaking(true); setIsPaused(false);
      if (ttsSettings.type === 'local') {
        if (!window.speechSynthesis) { toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." }); stopSpeech(true); return; }
        const utterance = new SpeechSynthesisUtterance(effectiveTextToRead);
        utterance.lang = ttsSettings.language; utterance.pitch = ttsSettings.pitch; utterance.rate = ttsSettings.rate;
        const voice = availableVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
        if (voice) utterance.voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === voice.voiceURI);
        const segments = effectiveTextToRead.match(/[^.!?]+[.!?]*|[^.!?]+/g) || []; setSentenceSegments(segments); setCurrentSentenceIndex(0);
        utterance.onboundary = (event) => { let c = 0; for (let i = 0; i < segments.length; i++) { if (event.charIndex >= c && event.charIndex < c + segments[i].length) { if(utteranceRef.current === utterance) setCurrentSentenceIndex(i); break; } c += segments[i].length; }};
        utterance.onend = () => { if(utteranceRef.current === utterance) stopSpeech(true); };
        utterance.onerror = (event) => { if(utteranceRef.current === utterance) { toast({ variant: "destructive", title: "TTS Error", description: event.error || "Failed." }); stopSpeech(true); }};
        utteranceRef.current = utterance; window.speechSynthesis.speak(utterance); setIsLoadingTTS(false);
      } else { // Cloud TTS
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
      if (key === 'language' && newSettings.type === 'local') {
        const suitableVoice = availableVoices.find(v => v.lang === value && v.default) || availableVoices.find(v => v.lang === value);
        newSettings.voiceURI = suitableVoice ? suitableVoice.voiceURI : undefined;
      }
      return newSettings;
    });
  };

  const handleFavoriteSelection = () => {
    const selection = window.getSelection()?.toString().trim() || currentTextForTTS;
    if (selection && activeDoc && !selection.startsWith("Error:") && !selection.startsWith("Failed to load") /* etc. */) {
      LocalStorageService.addFavoriteItem({ id: Date.now().toString(), text: selection, sourceDocumentId: activeDoc.id, sourceDocumentName: activeDoc.title, createdAt: Date.now() });
      toast({ title: "Favorited!", description: `"${selection.substring(0,50)}..." added.`});
    } else {
      toast({ variant: "destructive", title: "No Valid Text", description: "Ensure valid text is available to favorite." });
    }
  };

  // PDF Navigation
  const navigatePdf = (direction: 'prev' | 'next') => {
    if (!pdfDocProxy || isRenderingPdfPage) return;
    let newPage = currentPdfPageNum;
    if (direction === 'prev' && currentPdfPageNum > 1) newPage--;
    if (direction === 'next' && currentPdfPageNum < pdfTotalPages) newPage++;
    if (newPage !== currentPdfPageNum) { stopSpeech(true); setCurrentPdfPageNum(newPage); }
  };
  const handlePdfScale = (type: 'in' | 'out') => setPdfScale(s => type === 'in' ? Math.min(3, s + 0.25) : Math.max(0.5, s - 0.25));

  // EPUB Navigation
  const navigateEpub = (direction: 'prev' | 'next') => {
    if (!epubRendition) return;
    stopSpeech(true);
    if (direction === 'prev') epubRendition.prev(); else epubRendition.next();
  };

  const getButtonState = () => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const canPlay = !!(selectedText || (currentTextForTTS && !currentTextForTTS.startsWith("Error:") && !currentTextForTTS.startsWith("Failed to load") /* etc. */));
    if (isLoadingTTS) return { text: "Loading...", icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, disabled: true };
    if (isSpeaking) return isPaused ? { text: "Resume", icon: <Play className="mr-1 h-4 w-4" />, disabled: false } : { text: "Pause", icon: <Pause className="mr-1 h-4 w-4" />, disabled: false };
    return { text: selectedText ? "Play Selected" : "Play Text", icon: <Play className="mr-1 h-4 w-4" />, disabled: !canPlay };
  };
  const buttonState = getButtonState();

  if (isLoadingDoc) {
    return <div className="flex items-center justify-center h-full flex-grow"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-lg">Loading document...</p></div>;
  }
  
  if (docErrorMessage && !activeDoc) {
    return <div className="flex flex-col items-center justify-center h-full flex-grow p-4 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-xl font-semibold mb-2">Error Loading Document</h2>
        <p className="text-muted-foreground mb-4">{docErrorMessage}</p>
        <Button onClick={() => router.push('/library')}>Go to Library</Button>
    </div>;
  }


  return (
    <div className="flex flex-col lg:flex-row w-full h-[calc(100vh-4rem)]"> {/* Adjust height based on header */}
      {/* Main Content Area (Reader View) */}
      <div className="flex-grow overflow-y-auto bg-muted/20 p-2 md:p-4">
        {activeDoc?.type === 'pdf' && (
          <div className="flex flex-col items-center">
            {isRenderingPdfPage && !pdfPageImage && <Loader2 className="h-10 w-10 animate-spin my-8" />}
            {pdfPageImage && <NextImage src={pdfPageImage} alt={`Page ${currentPdfPageNum}`} width={800 * pdfScale} height={1100 * pdfScale} className="shadow-lg border rounded-md" />}
            {!pdfPageImage && !isRenderingPdfPage && <div className="my-8 text-muted-foreground">{(pdfDocProxy && pdfTotalPages > 0) ? `Select a page to render (1-${pdfTotalPages})` : 'No PDF page to display.'}</div>}
          </div>
        )}
        {activeDoc?.type === 'epub' && (
          <div ref={epubViewerRef} className="w-full h-full epub-viewer-container bg-background rounded-md shadow-inner">
            {!epubRendition && <Loader2 className="h-10 w-10 animate-spin m-auto" />}
          </div>
        )}
        {activeDoc?.type === 'txt' && (
          <pre className="whitespace-pre-wrap p-4 bg-background rounded-md shadow-inner text-sm font-mono h-full overflow-y-auto select-text">{txtContent}</pre>
        )}
        {activeDoc?.type === 'image' && imageSrc && (
            <div className="flex flex-col items-center">
                <NextImage src={imageSrc} alt={activeDoc.title || 'Uploaded Image'} width={800} height={600} style={{objectFit: 'contain'}} className="max-w-full max-h-[70vh] shadow-lg border rounded-md" />
                {(!activeDoc.extractedText || activeDoc.extractedText === "Image loaded. Perform OCR to extract text for reading aloud.") &&
                    <Button onClick={handlePerformOcrForImage} disabled={isPerformingOcr} className="mt-3">
                        {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR
                    </Button>
                }
            </div>
        )}
         {activeDoc?.type === 'mobi' && (
           <div className="p-4 bg-background rounded-md shadow-inner text-center">
             <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2"/>
             <p className="font-semibold">MOBI File Format</p>
             <p className="text-sm text-muted-foreground">Reading MOBI files directly is not supported. Please convert to EPUB or PDF.</p>
           </div>
         )}

        {/* Extracted text display for TTS debugging or selection, if needed */}
        { (activeDoc?.type === 'pdf' || activeDoc?.type === 'epub' || activeDoc?.type === 'image') && currentTextForTTS &&
            <Card className="mt-4 ">
                <CardHeader className="pb-1 pt-3">
                    <CardTitle className="text-sm flex items-center"><FileText className="mr-2 h-4 w-4"/> Current Text for TTS</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                    <textarea
                        readOnly
                        value={currentTextForTTS}
                        className="w-full h-24 p-2 border rounded-md bg-muted/30 text-xs select-text"
                        placeholder="Text for TTS will appear here..."
                    />
                </CardContent>
            </Card>
        }

      </div>

      {/* Controls Sidebar */}
      <div className="w-full lg:w-80 xl:w-96 p-3 border-l bg-background flex-shrink-0 overflow-y-auto space-y-4">
        <Card>
            <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-base truncate flex items-center gap-1">
                    <BookOpen className="h-5 w-5 text-primary"/> {activeDoc?.title || "No Document"}
                </CardTitle>
                {activeDoc && <CardDescription className="text-xs">Type: {activeDoc.type.toUpperCase()}</CardDescription>}
            </CardHeader>
        </Card>
        
        {/* Navigation Controls */}
        {(activeDoc?.type === 'pdf' && pdfTotalPages > 0) && (
          <Card>
            <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">PDF Navigation</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-0">
              <div className="flex items-center justify-between">
                <Button onClick={() => navigatePdf('prev')} disabled={currentPdfPageNum <= 1 || isRenderingPdfPage} size="sm" variant="outline"><ChevronLeft /> Prev</Button>
                <span className="text-smtabular-nums">Page {currentPdfPageNum} of {pdfTotalPages}</span>
                <Button onClick={() => navigatePdf('next')} disabled={currentPdfPageNum >= pdfTotalPages || isRenderingPdfPage} size="sm" variant="outline">Next <ChevronRight /></Button>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => handlePdfScale('out')} size="icon" variant="outline" className="h-7 w-7"><ZoomOut className="h-4 w-4"/></Button>
                <Slider value={[pdfScale]} min={0.5} max={3} step={0.25} onValueChange={([val]) => setPdfScale(val)} disabled={isRenderingPdfPage} />
                <Button onClick={() => handlePdfScale('in')} size="icon" variant="outline" className="h-7 w-7"><ZoomIn className="h-4 w-4"/></Button>
              </div>
            </CardContent>
          </Card>
        )}
        {activeDoc?.type === 'epub' && epubRendition && (
          <Card>
            <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">EPUB Navigation</CardTitle></CardHeader>
            <CardContent className="flex items-center justify-between pt-0">
              <Button onClick={() => navigateEpub('prev')} size="sm" variant="outline"><ChevronLeft /> Prev Section</Button>
              <Button onClick={() => navigateEpub('next')} size="sm" variant="outline">Next Section <ChevronRight /></Button>
            </CardContent>
          </Card>
        )}

        {/* TTS Controls */}
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
                  <SelectTrigger id="tts-voice" className="h-9 text-xs"><SelectValue placeholder="Select voice" /></SelectTrigger>
                  <SelectContent className="max-h-48">
                    {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).map(v => (<SelectItem key={v.voiceURI || v.name} value={v.voiceURI} className="text-xs">{v.name} ({v.lang})</SelectItem>))}
                    {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (<SelectItem value="no-voice-reader" disabled>{availableVoices.length > 0 ? "No voices for language" : "No local voices"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1"><Label htmlFor="tts-rate" className="text-xs">Rate: {ttsSettings.rate.toFixed(1)}</Label><Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={(isSpeaking && !isPaused)}/></div>
            <div className="space-y-1"><Label htmlFor="tts-pitch" className="text-xs">Pitch: {ttsSettings.pitch.toFixed(1)}</Label><Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={(isSpeaking && !isPaused)}/></div>
            <Button onClick={playPauseSpeech} disabled={buttonState.disabled} variant={isSpeaking && !isPaused ? "outline" : "default"} className="w-full h-9 text-sm">{buttonState.icon} {buttonState.text}</Button>
            <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="w-full mt-2"><Star className="mr-2 h-4 w-4" /> Favorite Text/Selection</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
