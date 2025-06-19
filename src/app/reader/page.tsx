
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import NextImage from 'next/image';
import type { Book as EpubBook, Rendition } from 'epubjs';
import { GlobalWorkerOptions, getDocument, version as pdfjsVersion } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';

import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Loader2, Play, Pause, Smartphone, Cloud as CloudIcon, Star, AlertTriangle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, BookOpen, Settings2, FileText, ScanText } from 'lucide-react';

import { getCloudSpeech, performOCR } from '@/app/actions';
import * as LocalStorageService from '@/lib/localStorageService';
import * as IndexedDBService from '@/lib/indexedDBService';
import type { TTSSettings, TTSVoice, StoredMangaDocument, ActiveMangaDocument } from '@/types';
import { cn } from '@/lib/utils';

const PDF_DEFAULT_SCALE = 1.5;
const MIN_PDF_TEXT_LENGTH_FOR_DIRECT_READ = 20;
const MIN_TTS_TEXT_LENGTH = 5;

export default function ReaderPage() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeDoc, setActiveDoc] = useState<ActiveMangaDocument | null>(null);
  const [isLoadingDoc, setIsLoadingDoc] = useState(true);
  const [docErrorMessage, setDocErrorMessage] = useState<string | null>(null);

  const [pdfDocProxy, setPdfDocProxy] = useState<PDFDocumentProxy | null>(null);
  const [currentPdfPageNum, setCurrentPdfPageNum] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfPageImage, setPdfPageImage] = useState<string | null>(null);
  const [isRenderingPdfPage, setIsRenderingPdfPage] = useState(false);
  const [pdfScale, setPdfScale] = useState(PDF_DEFAULT_SCALE);
  const [pdfPageIsTextBased, setPdfPageIsTextBased] = useState(true);

  const epubBookRef = useRef<EpubBook | null>(null);
  const epubRenditionRef = useRef<Rendition | null>(null);
  const epubViewerRef = useRef<HTMLDivElement>(null);

  const [txtContent, setTxtContent] = useState<string>("");
  
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const currentImageObjectUrlRef = useRef<string | null>(null);
  const [isPerformingOcr, setIsPerformingOcr] = useState(false);

  const [currentTextForTTS, setCurrentTextForTTS] = useState<string>("");

  const [ttsSettings, setTtsSettings] = useState<TTSSettings>(LocalStorageService.defaultTTSSettings);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);
  const [isLoadingTTS, setIsLoadingTTS] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && !GlobalWorkerOptions.workerSrc) {
      GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
    }
  }, []);

  const stopSpeech = useCallback((resetUIState = true) => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      if (audioPlayerRef.current.src && audioPlayerRef.current.readyState >= HTMLMediaElement.HAVE_METADATA) {
          try { audioPlayerRef.current.currentTime = 0; } catch (e) { /* ignore */ }
      }
    }
    if (utteranceRef.current) {
      utteranceRef.current.onend = null;
      utteranceRef.current.onboundary = null;
      utteranceRef.current.onerror = null;
      utteranceRef.current = null;
    }
    if (resetUIState) {
      setIsSpeaking(false);
      setIsPaused(false);
      setIsLoadingTTS(false);
    }
  }, []);
  
  useEffect(() => {
    const docId = searchParams.get('docId');

    // Initial reset of states before loading new document
    setActiveDoc(null);
    setPdfDocProxy(null);
    setCurrentPdfPageNum(1);
    setPdfTotalPages(0);
    setPdfPageImage(null);
    setPdfPageIsTextBased(true);
    setIsRenderingPdfPage(false);
    
    setImageSrc(null); // Clear imageSrc state
    // Note: currentImageObjectUrlRef is cleaned up by the return function of this effect

    setTxtContent("");
    setCurrentTextForTTS("");
    setDocErrorMessage(null);
    setIsLoadingDoc(true); 
    stopSpeech(true); // Stop any speech from a previous document

    // Clear EPUB viewer content
    if (epubViewerRef.current) {
        epubViewerRef.current.innerHTML = '';
    }
    // Note: epubRenditionRef and epubBookRef are cleaned up by the return function

    if (!docId) {
      setDocErrorMessage("No document ID provided. Please select a document from the Library.");
      setIsLoadingDoc(false);
      // Return the cleanup function even if no docId, to clean up potential previous state
      return () => {
        stopSpeech(true);
        if (epubRenditionRef.current) { epubRenditionRef.current.destroy(); epubRenditionRef.current = null; }
        if (epubBookRef.current) { epubBookRef.current = null; }
        if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
      };
    }

    IndexedDBService.getDocumentById(docId)
      .then(async (doc) => {
        if (!doc) {
          setDocErrorMessage(`Document with ID "${docId}" not found.`);
          setIsLoadingDoc(false);
          return;
        }

        // Explicitly clean up refs from a potentially previous doc loaded in the same component instance
        // This complements the main cleanup function which handles unmounts/dependency changes
        if (epubRenditionRef.current) { epubRenditionRef.current.destroy(); epubRenditionRef.current = null; }
        if (epubBookRef.current) { epubBookRef.current = null; }
        if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
        // setImageSrc(null); // Already set to null during initial reset phase of this effect run

        setActiveDoc(doc as ActiveMangaDocument);
        await IndexedDBService.saveLastActiveDocId(docId);

        if (doc.type === 'pdf') {
          try {
            const pdf = await getDocument({ data: doc.fileData.slice(0) }).promise;
            setPdfDocProxy(pdf);
            setPdfTotalPages(pdf.numPages);
            const savedPageIndex = LocalStorageService.loadCurrentPdfPageIndexForDoc(doc.id);
            setCurrentPdfPageNum( (savedPageIndex && savedPageIndex > 0 && savedPageIndex <= pdf.numPages) ? savedPageIndex : 1);
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
          try {
            const ePubModule = await import('epubjs');
            const ePub = ePubModule.default;
            epubBookRef.current = ePub(doc.fileData);
            await epubBookRef.current.ready;
            epubRenditionRef.current = epubBookRef.current.renderTo(epubViewerRef.current, { width: "100%", height: "100%", flow: "paginated", spread: "auto" });
            
            epubRenditionRef.current.on('displayed', async (section: any) => {
              try {
                const contents = section.contents || (section.document ? section.document.body : null);
                let text = "";
                if (contents && typeof contents.innerText === 'string') text = contents.innerText.replace(/\s+/g, ' ').trim();
                else if (contents && typeof contents.textContent === 'string') text = contents.textContent.replace(/\s+/g, ' ').trim();
                else if (section.output && typeof section.output === 'string') { 
                    const tempDiv = document.createElement('div'); tempDiv.innerHTML = section.output; 
                    text = (tempDiv.innerText || tempDiv.textContent || "").replace(/\s+/g, ' ').trim(); 
                }
                setCurrentTextForTTS(text || "Could not extract text from this EPUB section.");
              } catch (textExtractError: any) { console.error("Error extracting text from EPUB section:", textExtractError); setCurrentTextForTTS(`Error extracting text from EPUB: ${textExtractError.message}`); }
            });
            await epubRenditionRef.current.display();
          } catch (e: any) {
            console.error("Error loading or rendering EPUB:", e);
            const errorMsg = e instanceof Error ? e.message : String(e);
            const userFriendlyError = errorMsg.toLowerCase().includes("uncompressed data size mismatch") || errorMsg.toLowerCase().includes("reading 'package'")
              ? `Failed to load EPUB: The file might be corrupted or not a valid EPUB. (Detail: ${errorMsg})`
              : `Failed to load EPUB: ${errorMsg}`;
            setDocErrorMessage(userFriendlyError);
            setCurrentTextForTTS(userFriendlyError);
          }
        } else if (doc.type === 'txt') {
          const decoder = new TextDecoder();
          const text = decoder.decode(doc.fileData);
          setTxtContent(text);
          setCurrentTextForTTS(text);
        } else if (doc.type === 'image') {
          const blob = new Blob([doc.fileData], { type: doc.originalType });
          const newUrl = URL.createObjectURL(blob);
          currentImageObjectUrlRef.current = newUrl; // Track this new URL
          setImageSrc(newUrl); // Set state to trigger re-render
          setCurrentTextForTTS(doc.extractedText || "Image loaded. Perform OCR to extract text for reading aloud.");
        } else if (doc.type === 'mobi') {
          setDocErrorMessage("MOBI file format is not directly supported for reading. Please convert it to EPUB or PDF.");
          setCurrentTextForTTS("MOBI files cannot be read directly. Please convert to a supported format like EPUB or PDF.");
        }
        setIsLoadingDoc(false);
      })
      .catch(err => {
        console.error("Error loading document from IndexedDB:", err);
        setDocErrorMessage(`Error loading document: ${err.message}`);
        setCurrentTextForTTS(`Error loading document: ${err.message}`);
        setIsLoadingDoc(false);
      });
      
    return () => { // Cleanup function
      stopSpeech(true);
      if (epubRenditionRef.current) {
        epubRenditionRef.current.destroy();
        epubRenditionRef.current = null;
      }
      if (epubBookRef.current) {
        epubBookRef.current = null;
      }
      if (currentImageObjectUrlRef.current) {
        URL.revokeObjectURL(currentImageObjectUrlRef.current);
        currentImageObjectUrlRef.current = null;
      }
    };
  }, [searchParams, router, stopSpeech]);
  
  useEffect(() => {
    if (activeDoc?.type === 'pdf' && pdfDocProxy && currentPdfPageNum > 0 && currentPdfPageNum <= pdfTotalPages) {
      stopSpeech(true);
      setIsRenderingPdfPage(true);
      setPdfPageImage(null); 
      setPdfPageIsTextBased(true);
      setCurrentTextForTTS("Loading PDF page...");
      LocalStorageService.saveCurrentPdfPageIndexForDoc(activeDoc.id, currentPdfPageNum);

      pdfDocProxy.getPage(currentPdfPageNum).then(async (page: PDFPageProxy) => {
        const viewport = page.getViewport({ scale: pdfScale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        if (context) {
          await page.render({ canvasContext: context, viewport }).promise;
          setPdfPageImage(canvas.toDataURL('image/png'));
        }
        
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim();
        
        if (pageText && pageText.length >= MIN_PDF_TEXT_LENGTH_FOR_DIRECT_READ) { 
          setCurrentTextForTTS(pageText);
          setPdfPageIsTextBased(true);
        } else {
          setCurrentTextForTTS("This PDF page has no selectable text or is image-based. Use OCR to extract text for reading.");
          setPdfPageIsTextBased(false);
        }
      }).catch(e => {
        console.error("Error rendering PDF page:", e);
        setPdfPageImage(null);
        setCurrentTextForTTS(`Error rendering PDF page ${currentPdfPageNum}: ${e.message}`);
        setPdfPageIsTextBased(false);
      }).finally(() => {
        setIsRenderingPdfPage(false);
      });
    }
  }, [pdfDocProxy, currentPdfPageNum, pdfTotalPages, pdfScale, activeDoc?.id, activeDoc?.type, stopSpeech]);


  const handlePerformOcr = async () => {
    stopSpeech(true);
    let dataUrlToProcess: string | null = null;

    if (activeDoc?.type === 'pdf' && pdfPageImage && !pdfPageIsTextBased) {
        dataUrlToProcess = pdfPageImage;
    } else if (activeDoc?.type === 'image' && activeDoc.fileData) {
        try {
          // Use the currentImageObjectUrlRef if available and valid, otherwise generate new data URL
          // This avoids re-converting arraybuffer if image is already displayed.
          // However, for OCR, a direct base64 data URL is generally preferred by Genkit flow.
          if (imageSrc && imageSrc.startsWith('blob:')) { // If it's an object URL
             dataUrlToProcess = await IndexedDBService.arrayBufferToBase64DataURL(activeDoc.fileData, activeDoc.originalType);
          } else if (imageSrc) { // If it's already a data URL (less likely with current setup)
             dataUrlToProcess = imageSrc;
          } else { // Fallback to conversion if imageSrc not set or invalid type
             dataUrlToProcess = await IndexedDBService.arrayBufferToBase64DataURL(activeDoc.fileData, activeDoc.originalType);
          }
        } catch (conversionError) {
          toast({variant: "destructive", title: "OCR Error", description: "Could not prepare image data for OCR."});
          console.error("Error converting image ArrayBuffer to Base64 for OCR:", conversionError);
          return;
        }
    }
    
    if (!dataUrlToProcess) {
        toast({ variant: "destructive", title: "OCR Error", description: "No image data available for OCR." });
        return;
    }

    setIsPerformingOcr(true);
    setCurrentTextForTTS("Performing OCR...");
    try {
        const result = await performOCR(dataUrlToProcess);
        if ('extractedText' in result) {
            const ocrText = result.extractedText || "OCR completed, but no text found.";
            setCurrentTextForTTS(ocrText);
            if (activeDoc?.type === 'image' && activeDoc) { 
                const updatedDoc = { ...activeDoc, extractedText: ocrText };
                await IndexedDBService.saveDocument(updatedDoc);
                setActiveDoc(updatedDoc); 
            }
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
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const loadedSettings = LocalStorageService.loadTTSSettings();
      setTtsSettings(prev => ({ ...prev, ...loadedSettings, type: loadedSettings.type || 'local', engine: loadedSettings.engine || loadedSettings.type || 'local' }));
    }
  }, []);

  const populateVoiceList = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const voices = window.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService, default: v.default }));
      setAvailableVoices(voices);
    }
  }, []);

  useEffect(() => {
    populateVoiceList();
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = populateVoiceList;
    }
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.onvoiceschanged = null;
      }
      stopSpeech(true);
    };
  }, [populateVoiceList, stopSpeech]);
  
 useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis && ttsSettings.type === 'local') {
      const voices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService, default: v.default }));
      if(voices.length === 0 && availableVoices.length === 0) return; // Voices not loaded yet

      const currentSystemVoices = window.speechSynthesis.getVoices(); // Get fresh system voices for setting actual SpeechSynthesisVoice

      let voiceToSet: TTSVoice | undefined = ttsSettings.voiceURI ? voices.find(v => v.voiceURI === ttsSettings.voiceURI) : undefined;
      let langToSet = ttsSettings.language;
      let settingsChanged = false;

      if (!voiceToSet || (voiceToSet && !voiceToSet.lang.startsWith(ttsSettings.language.split('-')[0]))) {
        const defaultForLang = voices.find(v => v.lang === ttsSettings.language && v.default) ||
                               voices.find(v => v.lang === ttsSettings.language) ||
                               voices.find(v => v.lang?.startsWith(ttsSettings.language.split('-')[0]) && v.default) ||
                               voices.find(v => v.lang?.startsWith(ttsSettings.language.split('-')[0]));
        if (defaultForLang) {
          voiceToSet = defaultForLang;
          langToSet = defaultForLang.lang;
        } else {
          const absoluteFallback = voices.find(v => v.default && v.lang) || (voices.length > 0 ? voices[0] : undefined);
          if (absoluteFallback) {
            voiceToSet = absoluteFallback;
            langToSet = absoluteFallback.lang;
          }
        }
      }
      
      const newVoiceURI = voiceToSet ? voiceToSet.voiceURI : undefined;
      if (newVoiceURI !== ttsSettings.voiceURI) {
         setTtsSettings(prev => ({ ...prev, voiceURI: newVoiceURI }));
         settingsChanged = true;
      }
      if (langToSet !== ttsSettings.language) {
         setTtsSettings(prev => ({ ...prev, language: langToSet }));
         settingsChanged = true;
      }

      if(settingsChanged) LocalStorageService.saveTTSSettings({...ttsSettings, voiceURI: newVoiceURI, language: langToSet});

    } else if (ttsSettings.type === 'cloud') {
      if (ttsSettings.voiceURI) {
         setTtsSettings(prev => ({ ...prev, voiceURI: undefined }));
         LocalStorageService.saveTTSSettings({...ttsSettings, voiceURI: undefined});
      } else {
        LocalStorageService.saveTTSSettings(ttsSettings);
      }
    } else {
         LocalStorageService.saveTTSSettings(ttsSettings);
    }
  }, [ttsSettings.type, ttsSettings.language, ttsSettings.voiceURI, availableVoices, ttsSettings]);


  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;

    const handleAudioEnded = () => { if (audioPlayerRef.current === player && isSpeaking && ttsSettings.type === 'cloud') stopSpeech(true); };
    const handleAudioPlaying = () => { if (audioPlayerRef.current === player && ttsSettings.type === 'cloud' && isSpeaking) setIsLoadingTTS(false); };
    const handleAudioError = (e: Event) => { if (audioPlayerRef.current === player && isSpeaking && ttsSettings.type === 'cloud') { toast({variant: "destructive", title: "Audio Error", description: "Failed to play cloud TTS audio."}); console.error("Cloud TTS Audio Error:", e); stopSpeech(true); }};

    player.addEventListener('ended', handleAudioEnded);
    player.addEventListener('playing', handleAudioPlaying);
    player.addEventListener('error', handleAudioError);

    return () => {
        player.removeEventListener('ended', handleAudioEnded);
        player.removeEventListener('playing', handleAudioPlaying);
        player.removeEventListener('error', handleAudioError);
        if (player.src && !player.paused) player.pause();
        if (audioPlayerRef.current === player) audioPlayerRef.current = null;
    };
  }, [ttsSettings.type, isSpeaking, stopSpeech, toast]);

  const playPauseSpeech = async () => {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    const selectedTextFromSelection = selection?.toString().trim();
    const effectiveTextToRead = selectedTextFromSelection || currentTextForTTS;

    const invalidMessages = [
      "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", 
      "Image loaded. Perform OCR", "No text content found", "Could not extract text",
      "EPUB viewer element not", "EPUB section loaded, but text extraction",
      "This PDF page has no selectable text", "MOBI files cannot be read directly.",
      "This PDF page seems to be an image. Use OCR to extract text.",
      "Performing OCR...", "No document ID provided", "Document with ID",
      "EPUB viewer element not ready", "MOBI file format is not directly supported",
      "OCR completed, but no text found."
    ];

    if (!effectiveTextToRead || invalidMessages.some(msg => effectiveTextToRead.startsWith(msg)) || effectiveTextToRead.length < MIN_TTS_TEXT_LENGTH) {
      toast({ variant: "destructive", title: "No Valid Text", description: "No valid text to read, document processing, or text too short." });
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
      stopSpeech(false); 
      setIsLoadingTTS(true);
      setIsSpeaking(true);
      setIsPaused(false);

      if (ttsSettings.type === 'local') {
        if (typeof window === 'undefined' || !window.speechSynthesis) { toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." }); stopSpeech(true); return; }
        
        const utterance = new SpeechSynthesisUtterance(effectiveTextToRead);
        utterance.lang = ttsSettings.language; utterance.pitch = ttsSettings.pitch; utterance.rate = ttsSettings.rate;
        
        const systemVoices = window.speechSynthesis.getVoices();
        let voiceToUse: SpeechSynthesisVoice | undefined = undefined;

        if (ttsSettings.voiceURI) voiceToUse = systemVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
        
        if (!voiceToUse && ttsSettings.language) { // Try to find based on language
            voiceToUse = systemVoices.find(v => v.lang === ttsSettings.language && v.default) ||
                         systemVoices.find(v => v.lang === ttsSettings.language) ||
                         systemVoices.find(v => v.lang?.startsWith(ttsSettings.language.split('-')[0]) && v.default) ||
                         systemVoices.find(v => v.lang?.startsWith(ttsSettings.language.split('-')[0]));
        }
        if (!voiceToUse && systemVoices.length > 0) voiceToUse = systemVoices.find(v => v.default && v.lang) || systemVoices[0];

        if (voiceToUse) {
          utterance.voice = voiceToUse;
        } else if (systemVoices.length === 0 && availableVoices.length === 0) { 
          toast({variant: "destructive", title: "TTS Error", description: "No speech synthesis voices available in this browser."}); stopSpeech(true); return; 
        }
        // If still no voiceToUse but voices are available, browser will pick one based on utterance.lang

        utterance.onend = () => { if(utteranceRef.current === utterance) stopSpeech(true); };
        utterance.onerror = (event) => { if(utteranceRef.current === utterance) { toast({ variant: "destructive", title: "TTS Error", description: event.error || "Speech failed." }); stopSpeech(true); }};
        utteranceRef.current = utterance; 
        window.speechSynthesis.speak(utterance); 
        setIsLoadingTTS(false);
      } else { 
        try {
          const result = await getCloudSpeech(effectiveTextToRead, ttsSettings.language);
          if ('audioUrl' in result && audioPlayerRef.current) { 
            audioPlayerRef.current.src = result.audioUrl; 
            await audioPlayerRef.current.play(); 
          }
          else if ('error' in result) { toast({ variant: "destructive", title: "Cloud TTS Error", description: result.error }); stopSpeech(true); }
        } catch (e: any) { toast({ variant: "destructive", title: "Cloud TTS Failed", description: e.message }); stopSpeech(true); }
      }
    }
  };

  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    stopSpeech(true);
    setTtsSettings(prev => {
      let newSettings = { ...prev, [key]: value };
      if (key === 'type' && value === 'cloud') {
          newSettings.voiceURI = undefined;
      }
      // Default voice selection logic is now in the useEffect for ttsSettings
      // LocalStorageService.saveTTSSettings(newSettings); // This is now handled by dedicated useEffect
      return newSettings;
    });
  };

  const handleFavoriteSelection = () => {
    const selection = window.getSelection()?.toString().trim() || currentTextForTTS;
    const invalidMessages = [
      "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", 
      "Image loaded. Perform OCR", "No text content found", "Could not extract text",
      "EPUB viewer element not", "EPUB section loaded, but text extraction",
      "This PDF page has no selectable text", "MOBI files cannot be read directly.",
      "This PDF page seems to be an image. Use OCR to extract text.",
      "Performing OCR...", "No document ID provided", "Document with ID",
      "EPUB viewer element not ready", "MOBI file format is not directly supported",
      "OCR completed, but no text found."
    ];
    if (selection && activeDoc && !invalidMessages.some(msg => selection.startsWith(msg)) && selection.length >= MIN_TTS_TEXT_LENGTH) {
      LocalStorageService.addFavoriteItem({ id: Date.now().toString(), text: selection, sourceDocumentId: activeDoc.id, sourceDocumentName: activeDoc.title, createdAt: Date.now() });
      toast({ title: "Favorited!", description: `"${selection.substring(0,50)}..." added.`});
    } else {
      toast({ variant: "destructive", title: "No Valid Text", description: `Ensure valid text (min ${MIN_TTS_TEXT_LENGTH} chars) is available or selected to favorite.` });
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
    stopSpeech(true); 
    setPdfScale(newScale);
  };

  const navigateEpub = (direction: 'prev' | 'next') => {
    if (!epubRenditionRef.current || isLoadingDoc) return;
    stopSpeech(true);
    if (direction === 'prev') epubRenditionRef.current.prev(); else epubRenditionRef.current.next();
  };

  const getButtonState = () => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const effectiveText = selectedText || currentTextForTTS;
    const invalidMessages = [ 
      "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", 
      "Image loaded. Perform OCR", "No text content found", "Could not extract text",
      "EPUB viewer element not", "EPUB section loaded, but text extraction",
      "This PDF page has no selectable text", "MOBI files cannot be read directly.",
      "This PDF page seems to be an image. Use OCR to extract text.",
      "Performing OCR...", "No document ID provided", "Document with ID",
      "EPUB viewer element not ready", "MOBI file format is not directly supported",
      "OCR completed, but no text found."
    ];
    const canPlay = !!(effectiveText && !invalidMessages.some(msg => effectiveText.startsWith(msg)) && effectiveText.length >= MIN_TTS_TEXT_LENGTH && activeDoc && !isLoadingDoc && !isPerformingOcr);
    
    if (isLoadingTTS) return { text: "Loading...", icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, disabled: true };
    if (isSpeaking && !isPaused) return { text: "Pause", icon: <Pause className="mr-1 h-4 w-4" />, disabled: false };
    if (isSpeaking && isPaused) return { text: "Resume", icon: <Play className="mr-1 h-4 w-4" />, disabled: false };
    return { text: selectedText ? "Play Selected" : "Play Text", icon: <Play className="mr-1 h-4 w-4" />, disabled: !canPlay };
  };
  const buttonState = getButtonState();

  if (isLoadingDoc && !activeDoc && !docErrorMessage) {
    return <div className="flex items-center justify-center h-full flex-grow"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-lg">Loading document...</p></div>;
  }
  
  if (docErrorMessage && (!activeDoc || (activeDoc && activeDoc.type !== 'pdf' && activeDoc.type !== 'epub' && activeDoc.type !== 'txt' && activeDoc.type !== 'image') ) ) {
    return <div className="flex flex-col items-center justify-center h-full flex-grow p-4 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-xl font-semibold mb-2">Error Loading Document</h2>
        <p className="text-muted-foreground mb-4">{docErrorMessage}</p>
        <Button onClick={() => router.push('/library')}>Go to Library</Button>
    </div>;
  }
  
  const showOcrButtonForPdf = activeDoc?.type === 'pdf' && !pdfPageIsTextBased && pdfPageImage && !isRenderingPdfPage;
  const showOcrButtonForImage = activeDoc?.type === 'image' && imageSrc && (!activeDoc.extractedText || currentTextForTTS.startsWith("Image loaded. Perform OCR"));


  return (
    <div className="flex flex-col lg:flex-row w-full h-[calc(100vh-4rem)]">
      <div className="flex-grow overflow-y-auto bg-muted/20 p-2 md:p-4 relative">
        {docErrorMessage && activeDoc && (activeDoc.type === 'epub' || activeDoc.type === 'pdf') && (
            <div className="absolute inset-x-0 top-4 mx-auto w-fit max-w-md bg-destructive/10 border border-destructive text-destructive p-3 rounded-md shadow-lg z-10 flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div>
                    <p className="font-medium text-sm">Document Display Issue</p>
                    <p className="text-xs">{docErrorMessage}</p>
                     <Button variant="ghost" size="sm" className="text-xs h-auto p-1 mt-1 text-destructive hover:bg-destructive/20" onClick={() => setDocErrorMessage(null)}>Dismiss</Button>
                </div>
            </div>
        )}

        {isLoadingDoc && activeDoc && <div className="flex items-center justify-center h-full"><Loader2 className="h-10 w-10 animate-spin text-primary" /><p className="ml-3">Loading content...</p></div>}

        {!isLoadingDoc && activeDoc?.type === 'pdf' && (
          <div className="flex flex-col items-center">
            {isRenderingPdfPage && !pdfPageImage && <Loader2 className="h-10 w-10 animate-spin my-8" />}
            {pdfPageImage && <NextImage src={pdfPageImage} alt={`Page ${currentPdfPageNum}`} width={0} height={0} sizes="100vw" style={{ width: 'auto', height: 'auto', maxHeight: 'calc(100vh - 12rem)', maxWidth: '100%', objectFit: 'contain' }} className="shadow-lg border rounded-md" />}
            {!pdfPageImage && !isRenderingPdfPage && !docErrorMessage && (pdfDocProxy && pdfTotalPages > 0) && <div className="my-8 text-muted-foreground">{`Rendering page ${currentPdfPageNum}...`}</div>}
             {showOcrButtonForPdf && (
                <Button onClick={handlePerformOcr} disabled={isPerformingOcr} className="mt-3">
                    {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR on PDF Page
                </Button>
            )}
          </div>
        )}
        {!isLoadingDoc && activeDoc?.type === 'epub' && (
          <div ref={epubViewerRef} className={cn("w-full h-full epub-viewer-container bg-background rounded-md shadow-inner", (isLoadingDoc || !epubRenditionRef.current) && "opacity-50 flex items-center justify-center")}>
            {(!epubRenditionRef.current || (isLoadingDoc && !epubBookRef.current)) && !docErrorMessage && <Loader2 className="h-10 w-10 animate-spin" />}
          </div>
        )}
        {!isLoadingDoc && activeDoc?.type === 'txt' && (
          <pre className="whitespace-pre-wrap p-4 bg-background rounded-md shadow-inner text-sm font-mono h-full overflow-y-auto select-text">{txtContent}</pre>
        )}
        {!isLoadingDoc && activeDoc?.type === 'image' && imageSrc && (
            <div className="flex flex-col items-center">
                <NextImage src={imageSrc} alt={activeDoc.title || 'Uploaded Image'} width={800} height={600} style={{objectFit: 'contain'}} className="max-w-full max-h-[calc(100vh-15rem)] shadow-lg border rounded-md" />
                {showOcrButtonForImage &&
                    <Button onClick={handlePerformOcr} disabled={isPerformingOcr} className="mt-3">
                        {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR on Image
                    </Button>
                }
            </div>
        )}
         {!isLoadingDoc && activeDoc?.type === 'mobi' && (
           <div className="p-4 bg-background rounded-md shadow-inner text-center h-full flex flex-col justify-center items-center">
             <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2"/>
             <p className="font-semibold">MOBI File Format Not Supported</p>
             <p className="text-sm text-muted-foreground">Reading MOBI files directly is not supported. Please convert your MOBI file to EPUB or PDF format and upload it again.</p>
           </div>
         )}

        { (activeDoc?.type === 'pdf' || activeDoc?.type === 'epub' || activeDoc?.type === 'image' || activeDoc?.type === 'txt') && currentTextForTTS && !docErrorMessage && !isLoadingDoc &&
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
                {activeDoc && <CardDescription className="text-xs">Type: {activeDoc.type.toUpperCase()}{activeDoc.type === 'pdf' && pdfTotalPages > 0 ? `, ${currentPdfPageNum}/${pdfTotalPages} pages` : ''}</CardDescription>}
                 {!activeDoc && !isLoadingDoc && <CardDescription className="text-xs text-destructive">No document is currently loaded or an error occurred.</CardDescription>}
            </CardHeader>
        </Card>
        
        {(activeDoc?.type === 'pdf' && pdfTotalPages > 0) && (
          <Card>
            <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">PDF Navigation & View</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-0">
              <div className="flex items-center justify-between">
                <Button onClick={() => navigatePdf('prev')} disabled={currentPdfPageNum <= 1 || isRenderingPdfPage || isLoadingDoc} size="sm" variant="outline"><ChevronLeft /> Prev</Button>
                <span className="text-sm tabular-nums"> {currentPdfPageNum} / {pdfTotalPages}</span>
                <Button onClick={() => navigatePdf('next')} disabled={currentPdfPageNum >= pdfTotalPages || isRenderingPdfPage || isLoadingDoc} size="sm" variant="outline">Next <ChevronRight /></Button>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => handlePdfScaleChange(pdfScale - 0.25)} size="icon" variant="outline" className="h-7 w-7" disabled={isRenderingPdfPage || pdfScale <= 0.5 || isLoadingDoc}><ZoomOut className="h-4 w-4"/></Button>
                <Slider value={[pdfScale]} min={0.5} max={3} step={0.25} onValueChange={([val]) => handlePdfScaleChange(val)} disabled={isRenderingPdfPage || isLoadingDoc} />
                <Button onClick={() => handlePdfScaleChange(pdfScale + 0.25)} size="icon" variant="outline" className="h-7 w-7" disabled={isRenderingPdfPage || pdfScale >=3 || isLoadingDoc}><ZoomIn className="h-4 w-4"/></Button>
              </div>
            </CardContent>
          </Card>
        )}
        {activeDoc?.type === 'epub' && epubRenditionRef.current && (
          <Card>
            <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">EPUB Navigation</CardTitle></CardHeader>
            <CardContent className="flex items-center justify-between pt-0">
              <Button onClick={() => navigateEpub('prev')} size="sm" variant="outline" disabled={isLoadingDoc || !epubRenditionRef.current}><ChevronLeft /> Previous</Button>
              <Button onClick={() => navigateEpub('next')} size="sm" variant="outline" disabled={isLoadingDoc || !epubRenditionRef.current}>Next <ChevronRight /></Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm flex items-center gap-1"><Settings2 className="h-4 w-4"/> Text-to-Speech</CardTitle></CardHeader>
          <CardContent className="space-y-2 pt-0">
            <div>
              <Label htmlFor="tts-engine" className="text-xs">Engine</Label>
              <Select value={ttsSettings.type} onValueChange={(v) => handleSettingChange('type', v as 'local' | 'cloud')} disabled={(isSpeaking && !isPaused) || isLoadingDoc}>
                <SelectTrigger id="tts-engine" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="local"><div className="flex items-center gap-1 text-xs"><Smartphone className="h-3 w-3"/>Local</div></SelectItem><SelectItem value="cloud"><div className="flex items-center gap-1 text-xs"><CloudIcon className="h-3 w-3"/>Cloud</div></SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tts-language" className="text-xs">Language</Label>
              <Input id="tts-language" className="h-9 text-xs" value={ttsSettings.language} onChange={(e) => handleSettingChange('language', e.target.value)} disabled={(isSpeaking && !isPaused) || (ttsSettings.type === 'local' && availableVoices.length === 0) || isLoadingDoc} />
            </div>
            {ttsSettings.type === 'local' && (
              <div>
                <Label htmlFor="tts-voice" className="text-xs">Voice (Local)</Label>
                <Select value={ttsSettings.voiceURI || ""} onValueChange={(v) => handleSettingChange('voiceURI', v)} disabled={(isSpeaking && !isPaused) || availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 || isLoadingDoc}>
                  <SelectTrigger id="tts-voice" className="h-9 text-xs"><SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No voices available"} /></SelectTrigger>
                  <SelectContent className="max-h-48">
                    {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).map(v => (<SelectItem key={v.voiceURI || v.name} value={v.voiceURI || ""} className="text-xs">{v.name} ({v.lang})</SelectItem>))}
                    {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (<SelectItem value="no-voice-reader" disabled>{availableVoices.length > 0 ? "No voices for language" : "No local voices"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1"><Label htmlFor="tts-rate" className="text-xs">Rate: {ttsSettings.rate.toFixed(1)}</Label><Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={(isSpeaking && !isPaused) || isLoadingDoc}/></div>
            <div className="space-y-1"><Label htmlFor="tts-pitch" className="text-xs">Pitch: {ttsSettings.pitch.toFixed(1)}</Label><Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={(isSpeaking && !isPaused) || isLoadingDoc}/></div>
            <Button onClick={playPauseSpeech} disabled={buttonState.disabled} variant={isSpeaking && !isPaused ? "outline" : "default"} className="w-full h-9 text-sm">{buttonState.icon} {buttonState.text}</Button>
            <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="w-full mt-2" disabled={!activeDoc || isLoadingDoc || isPerformingOcr}><Star className="mr-2 h-4 w-4" /> Favorite Text/Selection</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

    