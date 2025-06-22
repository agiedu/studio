
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import NextImage from 'next/image';
import { GlobalWorkerOptions, getDocument, version as pdfjsVersion } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import type Book from 'epubjs/types/book';
import type Rendition from 'epubjs/types/rendition';


import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Loader2, Play, Pause, Smartphone, Cloud as CloudIcon, Star, AlertTriangle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, BookOpen, Settings2, FileText, ScanText, Trash2, Edit, Repeat, TextSelect, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";


import { getCloudSpeech, performOCR } from '@/app/actions';
import * as LocalStorageService from '@/lib/localStorageService';
import * as IndexedDBService from '@/lib/indexedDBService';
import type { TTSSettings, TTSVoice, StoredMangaDocument, ActiveMangaDocument, StoredPdfDocument, StoredImageDocument, StoredEpubDocument, StoredTxtDocument, StoredMobiDocument } from '@/types';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';

const PDF_DEFAULT_SCALE = 1.5;

type SpeechOrigin = 'main' | 'selection' | 'repeat' | null;

export default function ReaderPage() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeDoc, setActiveDoc] = useState<ActiveMangaDocument | null>(null);
  const [isLoadingDoc, setIsLoadingDoc] = useState(true);
  const [docErrorMessage, setDocErrorMessage] = useState<string | null>(null);

  // PDF specific states
  const [pdfDocProxy, setPdfDocProxy] = useState<PDFDocumentProxy | null>(null);
  const [currentPdfPageNum, setCurrentPdfPageNum] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfPageImage, setPdfPageImage] = useState<string | null>(null);
  const [isRenderingPdfPage, setIsRenderingPdfPage] = useState(false);
  const [pdfScale, setPdfScale] = useState(PDF_DEFAULT_SCALE);
  const [pdfPageIsTextBased, setPdfPageIsTextBased] = useState(true);

  // EPUB specific states and refs
  const epubViewerRef = useRef<HTMLDivElement | null>(null);
  const epubBookRef = useRef<Book | null>(null);
  const epubRenditionRef = useRef<Rendition | null>(null);
  const [isEpubLoading, setIsEpubLoading] = useState(false);

  // TXT and Image states
  const [txtContent, setTxtContent] = useState<string>("");
  const [displayedImageSrc, setDisplayedImageSrc] = useState<string | null>(null);
  const currentImageObjectUrlRef = useRef<string | null>(null);
  
  // Scratchpad state
  const [scratchpadText, setScratchpadText] = useState<string>(LocalStorageService.loadScratchpadText());

  // OCR and TTS states
  const [isPerformingOcr, setIsPerformingOcr] = useState(false);
  const [currentTextForTTS, setCurrentTextForTTS] = useState<string>("");
  const [ttsSettings, setTtsSettings] = useState<TTSSettings>(LocalStorageService.defaultTTSSettings);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);
  const [isLoadingTTS, setIsLoadingTTS] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speechOrigin, setSpeechOrigin] = useState<SpeechOrigin>(null);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const isMountedRef = useRef(false);

  // Refs for text selection
  const mainTextAreaRef = useRef<HTMLTextAreaElement | null>(null); // For Scratchpad, TXT
  const ttsBoxTextAreaRef = useRef<HTMLTextAreaElement | null>(null); // For the box at the bottom

  const getSelectedText = useCallback((): { text: string; startIndex: number | null } => {
    if (typeof window === 'undefined') {
      return { text: '', startIndex: null };
    }
  
    // Priority 1: Main content text area (Scratchpad, TXT)
    const mainTextarea = mainTextAreaRef.current;
    if (mainTextarea && mainTextarea.selectionStart !== mainTextarea.selectionEnd) {
      return {
        text: mainTextarea.value.substring(mainTextarea.selectionStart, mainTextarea.selectionEnd),
        startIndex: mainTextarea.selectionStart
      };
    }
    
    // Priority 2: Bottom TTS text area (PDF, Image)
    const ttsTextarea = ttsBoxTextAreaRef.current;
    if (ttsTextarea && ttsTextarea.selectionStart !== ttsTextarea.selectionEnd) {
      return {
        text: ttsTextarea.value.substring(ttsTextarea.selectionStart, ttsTextarea.selectionEnd),
        startIndex: ttsTextarea.selectionStart
      };
    }
  
    // Priority 3: EPUB iframe
    if (activeDoc?.type === 'epub' && epubRenditionRef.current) {
      try {
        const epubWindow = epubRenditionRef.current.getContents()?.[0]?.window;
        if (epubWindow) {
          const selection = epubWindow.getSelection();
          const selectionText = selection?.toString();
          if (selectionText) {
             // For EPUB, we can only reliably get the text, not a numeric index into a larger string.
             // The search logic will be handled by the caller.
            return { text: selectionText, startIndex: null };
          }
        }
      } catch (e) {
        console.warn("Could not get selection from EPUB iframe", e);
      }
    }
    
    // Priority 4: General page selection (fallback)
    const pageSelection = window.getSelection()?.toString();
    if (pageSelection) {
      return { text: pageSelection, startIndex: null };
    }
  
    return { text: '', startIndex: null };
  }, [activeDoc]);

  useEffect(() => {
    isMountedRef.current = true;
    if (typeof window !== 'undefined' && !GlobalWorkerOptions.workerSrc) {
      GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
    }
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Effect to persist scratchpad text
  useEffect(() => {
    // Only save when in scratchpad mode and not loading.
    if (!activeDoc && !isLoadingDoc) {
      LocalStorageService.saveScratchpadText(scratchpadText);
    }
  }, [scratchpadText, activeDoc, isLoadingDoc]);


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
      utteranceRef.current.onend = null; utteranceRef.current.onboundary = null; utteranceRef.current.onerror = null; utteranceRef.current = null;
    }
    if (resetUIState && isMountedRef.current) {
      setIsSpeaking(false); setIsPaused(false); setIsLoadingTTS(false); setSpeechOrigin(null);
    }
  }, []);

  // Main Effect for loading and cleaning up any document type
  useEffect(() => {
    const docId = searchParams.get('docId');
    let isStale = false;
    
    // This is the single source of truth for cleanup.
    // It runs before the effect body for a new docId, and on component unmount.
    const cleanup = () => {
      console.log("[Cleanup] Running cleanup for previous document.");
      stopSpeech(true);

      // Cleanup PDF
      if (pdfDocProxy) {
        try { pdfDocProxy.destroy(); } catch (e) { console.log("Non-critical error destroying PDF proxy", e); }
        setPdfDocProxy(null);
      }
      
      // Cleanup Image
      if (currentImageObjectUrlRef.current) {
        URL.revokeObjectURL(currentImageObjectUrlRef.current);
        currentImageObjectUrlRef.current = null;
      }
      
      // Cleanup EPUB
      if (epubBookRef.current) {
        try { epubBookRef.current.destroy(); } catch (e) { console.log("Non-critical error destroying EPUB book", e); }
        epubBookRef.current = null;
      }
      if (epubRenditionRef.current) {
        try { epubRenditionRef.current.destroy(); } catch (e) { console.log("Non-critical error destroying EPUB rendition", e); }
        epubRenditionRef.current = null;
      }
       if (epubViewerRef.current) {
        epubViewerRef.current.innerHTML = '';
      }
    };

    const loadDocument = async () => {
      if (!docId) {
        const lastActiveId = await IndexedDBService.getLastActiveDocId();
        if (isStale) return;
        if (lastActiveId) {
            router.replace(`/reader?docId=${lastActiveId}`, { scroll: false }); 
        } else {
            // No docId and no last active doc, so enter Scratchpad mode.
            setActiveDoc(null);
            setIsLoadingDoc(false);
            const savedText = LocalStorageService.loadScratchpadText();
            setScratchpadText(savedText);
            setCurrentTextForTTS(savedText);
        }
        return;
      }

      try {
        const doc = await IndexedDBService.getDocumentById(docId);
        if (isStale) return;

        if (!doc) {
          setDocErrorMessage(`Document with ID "${docId}" not found.`);
          await IndexedDBService.saveLastActiveDocId(null);
          setIsLoadingDoc(false);
          return;
        }
        
        setActiveDoc(doc as ActiveMangaDocument);
        await IndexedDBService.saveLastActiveDocId(docId);
        
        // Handle loading based on type
        switch (doc.type) {
          case 'pdf':
            const pdf = await getDocument({ data: doc.fileData.slice(0) }).promise;
            if(isStale) { try {pdf.destroy();} catch(e){} return; }
            setPdfDocProxy(pdf);
            setPdfTotalPages(pdf.numPages);
            const savedPageIndex = LocalStorageService.loadCurrentPdfPageIndexForDoc(doc.id);
            setCurrentPdfPageNum((savedPageIndex > 0 && savedPageIndex <= pdf.numPages) ? savedPageIndex : 1);
            // Page rendering will be handled by a separate effect watching pdfDocProxy and page number
            break;
          
          case 'epub':
            setIsEpubLoading(true);
            const ePubModule = await import('epubjs');
            const book = ePubModule.default(doc.fileData);
            epubBookRef.current = book;
            
            if (!epubViewerRef.current) {
              throw new Error("EPUB viewer element not ready.");
            }

            const rendition = book.renderTo(epubViewerRef.current, { width: "100%", height: "100%", flow: "paginated", spread: "none" });
            epubRenditionRef.current = rendition;

            rendition.on('displayed', async (sectionResult: any) => {
              if (isMountedRef.current && epubRenditionRef.current === rendition) {
                try {
                  const displayedContents = await rendition.getContents();
                  const body = displayedContents?.[0]?.document?.body;
                  // Use innerText to better reflect what the user sees, including line breaks.
                  const extractedText = body ? (body.innerText || body.textContent || "") : "";
                  setCurrentTextForTTS(extractedText || "EPUB section loaded. Text may be graphical or empty.");
                } catch (textExtractError) {
                  setCurrentTextForTTS("EPUB section loaded, but text could not be extracted.");
                }
              }
            });

            await rendition.display();
            if(isStale) return;

            setIsEpubLoading(false);
            setIsLoadingDoc(false);
            break;

          case 'image':
            const imgBlob = new Blob([doc.fileData], { type: doc.originalType });
            const imgUrl = URL.createObjectURL(imgBlob);
            currentImageObjectUrlRef.current = imgUrl;
            setDisplayedImageSrc(imgUrl);
            setCurrentTextForTTS((doc as StoredImageDocument).extractedText || "Image loaded. Perform OCR to extract text.");
            setIsLoadingDoc(false);
            break;
            
          case 'txt':
            const text = new TextDecoder().decode(doc.fileData);
            setTxtContent(text);
            setCurrentTextForTTS(text);
            setIsLoadingDoc(false);
            break;

          case 'mobi':
            setDocErrorMessage("MOBI files are not directly viewable. Please convert to EPUB or PDF.");
            setIsLoadingDoc(false);
            break;

          default:
            setIsLoadingDoc(false);
            break;
        }
      } catch (err: any) {
        if (isStale) return;
        console.error("Error loading document:", err);
        setDocErrorMessage(`Error loading document: ${err.message}`);
        setIsLoadingDoc(false);
        setActiveDoc(null);
      }
    };
    
    // Reset state before loading a new document
    cleanup();
    setDocErrorMessage(null);
    setActiveDoc(null);
    setIsLoadingDoc(true);
    setTxtContent("");
    setDisplayedImageSrc(null);
    setIsEpubLoading(false);
    setCurrentTextForTTS("");
    
    loadDocument();
    
    return () => {
      isStale = true;
      cleanup();
    };
  }, [searchParams, router]);


  // PDF Page Rendering Effect
  useEffect(() => {
    if (activeDoc?.type !== 'pdf' || !pdfDocProxy || !currentPdfPageNum) return;

    let isStale = false;
    const renderPage = async () => {
        stopSpeech(true); 
        setIsRenderingPdfPage(true); 
        setPdfPageImage(null); 
        setPdfPageIsTextBased(true); 
        setCurrentTextForTTS(`Loading PDF page ${currentPdfPageNum}...`);
        LocalStorageService.saveCurrentPdfPageIndexForDoc(activeDoc.id, currentPdfPageNum);

        try {
            const page: PDFPageProxy = await pdfDocProxy.getPage(currentPdfPageNum);
            if (isStale) { if (page) page.cleanup(); return; }
            
            const viewport = page.getViewport({ scale: pdfScale });
            const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
            canvas.height = viewport.height; canvas.width = viewport.width;
            
            if (context) await page.render({ canvasContext: context, viewport }).promise;
            if (isStale || !isMountedRef.current) { if (page) page.cleanup(); return; }
            setPdfPageImage(canvas.toDataURL('image/png'));
            
            const pdfDocFromState = activeDoc as StoredPdfDocument;
            if (pdfDocFromState.ocrTextPerPage?.[currentPdfPageNum]) {
                setCurrentTextForTTS(pdfDocFromState.ocrTextPerPage[currentPdfPageNum]); 
                setPdfPageIsTextBased(false);
            } else {
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim();
                if (pageText) {
                    setCurrentTextForTTS(pageText); 
                    setPdfPageIsTextBased(true);
                } else {
                    setCurrentTextForTTS("This PDF page has no selectable text. Use OCR to extract text."); 
                    setPdfPageIsTextBased(false);
                }
            }
            if (page) page.cleanup();
        } catch (e: any) {
            if (isStale || !isMountedRef.current) return;
            setDocErrorMessage(`Error rendering PDF page ${currentPdfPageNum}: ${e.message}`);
        } finally {
            if (isMountedRef.current) { 
                setIsLoadingDoc(false); 
                setIsRenderingPdfPage(false); 
            }
        }
    };

    renderPage();
    return () => { isStale = true; };
  }, [pdfDocProxy, currentPdfPageNum, pdfScale, activeDoc?.id]);


  const handlePerformOcr = useCallback(async () => {
    if (!activeDoc) { toast({ variant: "destructive", title: "OCR Error", description: "No active document." }); return; }
    if (!isMountedRef.current) return;
    stopSpeech(true); let dataUrlToProcess: string | null = null; const currentActiveDoc = activeDoc; 
    if (currentActiveDoc.type === 'pdf' && pdfPageImage && !pdfPageIsTextBased) { dataUrlToProcess = pdfPageImage;
    } else if (currentActiveDoc.type === 'image' && currentActiveDoc.fileData) {
        if(isMountedRef.current) setIsPerformingOcr(true);
        try {
            const docToProcess = await IndexedDBService.getDocumentById(currentActiveDoc.id) as StoredImageDocument | null;
            if (!docToProcess || !docToProcess.fileData || !docToProcess.originalType) { toast({variant: "destructive", title: "OCR Error", description: "Image data missing."}); if(isMountedRef.current) setIsPerformingOcr(false); return; }
            dataUrlToProcess = await IndexedDBService.arrayBufferToBase64DataURL(docToProcess.fileData, docToProcess.originalType);
        } catch (e: any) { toast({variant: "destructive", title: "OCR Error", description: `Image preparation failed: ${e.message}`}); if(isMountedRef.current) setIsPerformingOcr(false); return; }
    }
    if (!dataUrlToProcess) { toast({ variant: "destructive", title: "OCR Error", description: "No image data available for OCR." }); if(isMountedRef.current && isPerformingOcr) setIsPerformingOcr(false); return; }
    if(!isPerformingOcr && isMountedRef.current) setIsPerformingOcr(true); if(isMountedRef.current) setCurrentTextForTTS("Performing OCR...");
    try {
        const result = await performOCR(dataUrlToProcess);
        if(!isMountedRef.current) return; 
        if ('extractedText' in result) {
            const ocrText = result.extractedText || "OCR completed, no text found."; setCurrentTextForTTS(ocrText); 
            const docFromDB = await IndexedDBService.getDocumentById(currentActiveDoc.id);
            if (!docFromDB) { toast({ variant: "destructive", title: "OCR Save Error", description: "Document not found in DB." }); setIsPerformingOcr(false); return; }
            let updatedDocForSave: StoredMangaDocument = { ...docFromDB }; 
            if (updatedDocForSave.type === 'image') { (updatedDocForSave as StoredImageDocument).extractedText = ocrText;
            } else if (updatedDocForSave.type === 'pdf' && currentPdfPageNum) { 
                const ocrPages = { ...((updatedDocForSave as StoredPdfDocument).ocrTextPerPage || {}), [currentPdfPageNum]: ocrText };
                (updatedDocForSave as StoredPdfDocument).ocrTextPerPage = ocrPages;
                if(isMountedRef.current) setPdfPageIsTextBased(false); 
            }
            await IndexedDBService.saveDocument(updatedDocForSave);
            if (isMountedRef.current && activeDoc?.id === updatedDocForSave.id) { setActiveDoc(updatedDocForSave as ActiveMangaDocument); }
            toast({ title: "OCR Successful", description: "Text extracted and saved."});
        } else { setCurrentTextForTTS(""); setDocErrorMessage(`OCR Error: ${result.error}`); toast({ variant: "destructive", title: "OCR Error", description: result.error }); }
    } catch (e: any) {
      if(isMountedRef.current) { setCurrentTextForTTS(""); setDocErrorMessage(`OCR failed: ${e.message}`); toast({ variant: "destructive", title: "OCR Failed", description: e.message }); }
    } finally { if(isMountedRef.current) setIsPerformingOcr(false); }
  }, [activeDoc, pdfPageImage, pdfPageIsTextBased, currentPdfPageNum, stopSpeech, toast]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const loadedSettings = LocalStorageService.loadTTSSettings();
      const engine = loadedSettings.engine || loadedSettings.type || 'local';
      if (isMountedRef.current) setTtsSettings(prev => ({ ...prev, ...loadedSettings, type: engine, engine: engine }));
    }
  }, []);

  const populateVoiceList = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis && isMountedRef.current) {
        setAvailableVoices(prevVoices => {
            const newRawVoices = window.speechSynthesis.getVoices();
            const getSignature = (voices: (TTSVoice | SpeechSynthesisVoice)[]) => 
                [...voices].map(v => `${v.voiceURI}|${v.name}|${v.lang}`).sort().join(';');
            
            if (getSignature(prevVoices) === getSignature(newRawVoices)) {
                return prevVoices;
            }
            console.log("[TTS] Voices updated.");
            return newRawVoices.map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService, default: v.default }));
        });
    }
  }, []);

  useEffect(() => {
    populateVoiceList(); 
    if (typeof window !== 'undefined' && window.speechSynthesis) {
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
    if (!isMountedRef.current) return;
    const currentSettings = ttsSettings;
    let newVoiceURI = currentSettings.voiceURI;
    let newLanguage = currentSettings.language;
    let derivedSettingsChanged = false;

    if (currentSettings.engine === 'local') {
        const systemVoices = availableVoices;
        if (systemVoices.length > 0) {
            const currentVoice = systemVoices.find(v => v.voiceURI === currentSettings.voiceURI);
            const currentVoiceIsValidForLanguage = currentVoice && currentVoice.lang && (currentVoice.lang === currentSettings.language || currentVoice.lang.startsWith(currentSettings.language.split('-')[0]));
            
            if (!currentVoice || !currentVoiceIsValidForLanguage) {
                const defaultForLang = systemVoices.find(v => v.lang === currentSettings.language && v.default) ||
                                     systemVoices.find(v => v.lang === currentSettings.language) ||
                                     systemVoices.find(v => v.lang?.startsWith(currentSettings.language.split('-')[0]) && v.default) ||
                                     systemVoices.find(v => v.lang?.startsWith(currentSettings.language.split('-')[0]));
                if (defaultForLang) { newVoiceURI = defaultForLang.voiceURI; newLanguage = defaultForLang.lang;
                } else {
                    const absoluteFallback = systemVoices.find(v => v.default && v.lang) || (systemVoices.length > 0 ? systemVoices[0] : undefined);
                    if (absoluteFallback) { newVoiceURI = absoluteFallback.voiceURI; newLanguage = absoluteFallback.lang; }
                }
            }
        } else { newVoiceURI = undefined; }
    } else if (currentSettings.engine === 'cloud') {
        newVoiceURI = undefined;
    }

    if (newVoiceURI !== currentSettings.voiceURI || newLanguage !== currentSettings.language) {
        derivedSettingsChanged = true;
    }
    
    const finalSettingsToSave = { ...currentSettings, voiceURI: newVoiceURI, language: newLanguage };
    LocalStorageService.saveTTSSettings(finalSettingsToSave);

    if (derivedSettingsChanged && isMountedRef.current) {
        setTtsSettings(finalSettingsToSave);
    }
  }, [ttsSettings.engine, ttsSettings.language, availableVoices, ttsSettings.voiceURI]);


  useEffect(() => {
    const player = new Audio(); audioPlayerRef.current = player;
    const handleAudioEnded = () => { 
        if (audioPlayerRef.current === player && isSpeaking && ttsSettings.engine === 'cloud' && isMountedRef.current) { 
            if(speechOrigin === 'repeat' && audioPlayerRef.current) {
                audioPlayerRef.current.currentTime = 0;
                audioPlayerRef.current.play();
            } else {
                stopSpeech(true); 
            }
        } 
    };
    const handleAudioPlaying = () => { if (audioPlayerRef.current === player && ttsSettings.engine === 'cloud' && isSpeaking && isMountedRef.current) { setIsLoadingTTS(false); } };
    const handleAudioError = () => { if (audioPlayerRef.current === player && isSpeaking && ttsSettings.engine === 'cloud' && isMountedRef.current) { toast({variant: "destructive", title: "Audio Error", description: "Failed to play cloud TTS audio."}); stopSpeech(true); } };
    player.addEventListener('ended', handleAudioEnded); player.addEventListener('playing', handleAudioPlaying); player.addEventListener('error', handleAudioError);
    return () => {
        player.removeEventListener('ended', handleAudioEnded); player.removeEventListener('playing', handleAudioPlaying); player.removeEventListener('error', handleAudioError);
        if (player.src && !player.paused) player.pause(); player.src = "";
        if (audioPlayerRef.current === player) audioPlayerRef.current = null;
    };
  }, [ttsSettings.engine, isSpeaking, speechOrigin, stopSpeech, toast]);

  // Private function to initiate speech; assumes a clean state.
  const _startSpeech = useCallback(async (textToPlay: string, origin: SpeechOrigin) => {
    if (!isMountedRef.current) return;
    
    if (!textToPlay || textToPlay.trim() === '') {
        toast({variant: "destructive", title: "No Text", description: "There is no text to read."});
        stopSpeech(true);
        return;
    }

    setIsLoadingTTS(true);
    setIsSpeaking(true);
    setIsPaused(false);
    setSpeechOrigin(origin);

    if (ttsSettings.engine === 'local') {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
        stopSpeech(true);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(textToPlay);
      utterance.lang = ttsSettings.language;
      utterance.pitch = ttsSettings.pitch;
      utterance.rate = ttsSettings.rate;
      const systemVoices = window.speechSynthesis.getVoices();
      let voiceToUse: SpeechSynthesisVoice | undefined = systemVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
      if (voiceToUse) utterance.voice = voiceToUse;

      utterance.onend = () => {
        if (utteranceRef.current === utterance && isMountedRef.current) {
          if (origin === 'repeat') {
            window.speechSynthesis.speak(utterance);
          } else {
            stopSpeech(true);
          }
        }
      };
      utterance.onerror = (event) => {
        if(utteranceRef.current === utterance && isMountedRef.current) {
          toast({ variant: "destructive", title: "TTS Error", description: event.error || "Speech failed." });
          stopSpeech(true);
        }
      };
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
      if(isMountedRef.current) setIsLoadingTTS(false);
    } else {
      try {
        if (audioPlayerRef.current) {
            audioPlayerRef.current.loop = (origin === 'repeat');
        }
        const result = await getCloudSpeech(textToPlay, ttsSettings.language);
        if(!isMountedRef.current) return;
        if ('audioUrl' in result && audioPlayerRef.current) {
          audioPlayerRef.current.src = result.audioUrl;
          await audioPlayerRef.current.play();
        } else if ('error' in result) {
          toast({ variant: "destructive", title: "Cloud TTS Error", description: result.error });
          if(isMountedRef.current) stopSpeech(true);
        }
      } catch (e: any) {
        if(isMountedRef.current) {
          toast({ variant: "destructive", title: "Cloud TTS Failed", description: e.message });
          if(isMountedRef.current) stopSpeech(true);
        }
      }
    }
  }, [ttsSettings, stopSpeech, toast, availableVoices]);

  // Public controller to start speech. It always resets state first.
  const startSpeech = useCallback((textToPlay: string, origin: SpeechOrigin) => {
      stopSpeech(false); // Soft stop, don't reset UI immediately
      setTimeout(() => {
          if (isMountedRef.current) {
              _startSpeech(textToPlay, origin);
          }
      }, 50); // Small delay to ensure state is clean
  }, [_startSpeech, stopSpeech]);


  const playPauseSpeech = () => {
      if (!isMountedRef.current || typeof window === 'undefined' || !window.speechSynthesis) return;
  
      // Always query the browser's state first as the source of truth
      const isCurrentlySpeaking = window.speechSynthesis.speaking;
      const isCurrentlyPaused = window.speechSynthesis.paused;
  
      // Case 1: Speech is active and paused. We should resume.
      if (isCurrentlySpeaking && isCurrentlyPaused) {
          window.speechSynthesis.resume();
          setIsPaused(false);
          return;
      }
      
      // Case 2: Speech is active and not paused. We should pause.
      if (isCurrentlySpeaking && !isCurrentlyPaused) {
          window.speechSynthesis.pause();
          setIsPaused(true);
          return;
      }
      
      // Case 3: Nothing is happening. We should start a new speech from the beginning.
      // This will also handle taking over from other speech origins.
      if (!isCurrentlySpeaking) {
          // It's crucial to stop any previous, completed-but-not-cleared utterances.
          stopSpeech(false); // Use soft stop to not reset UI yet.
          setTimeout(() => {
              if (isMountedRef.current) {
                  _startSpeech(currentTextForTTS, 'main');
              }
          }, 50); // Delay to ensure cancelation completes.
      }
  };
  
  const handleRepeatSelection = () => {
    if (isSpeaking && speechOrigin === 'repeat') {
      stopSpeech(true);
      return;
    }
  
    stopSpeech(false); // Reset before starting new speech
    setTimeout(() => {
      if (!isMountedRef.current) return;
      const selectionInfo = getSelectedText();
      if (!selectionInfo.text) {
        toast({
          variant: "destructive",
          title: "No Text Selected",
          description: "Please select text to repeat.",
        });
        stopSpeech(true); // Fully reset UI if no text
        return;
      }
      _startSpeech(selectionInfo.text, 'repeat');
    }, 100);
  };
  
  const handlePlayFromSelection = () => {
    if (!isMountedRef.current) return;
  
    // If the selection player is already active, just pause/resume it
    if (isSpeaking && speechOrigin === 'selection') {
      if (isPaused) {
        if (ttsSettings.engine === 'local') window.speechSynthesis.resume();
        else if (audioPlayerRef.current) audioPlayerRef.current.play();
        setIsPaused(false);
      } else {
        if (ttsSettings.engine === 'local') window.speechSynthesis.pause();
        else if (audioPlayerRef.current) audioPlayerRef.current.pause();
        setIsPaused(true);
      }
      return;
    }
  
    // If any other speech is happening, stop it. Then start the new one.
    stopSpeech(false);
  
    setTimeout(() => {
      if (!isMountedRef.current) return;
  
      const selectionInfo = getSelectedText();
      if (!selectionInfo.text) {
        toast({ variant: 'default', title: 'No Text Selected', description: 'Please select text to start playing from that point.' });
        stopSpeech(true);
        return;
      }
  
      const fullText = activeDoc?.type === 'txt' ? txtContent :
                       !activeDoc ? scratchpadText :
                       currentTextForTTS;
      
      let textToPlay = '';
  
      // Prioritize precise index from textareas
      if (selectionInfo.startIndex !== null && (mainTextAreaRef.current || ttsBoxTextAreaRef.current)) {
        const sourceTextArea = mainTextAreaRef.current?.value === fullText ? mainTextAreaRef.current : ttsBoxTextAreaRef.current;
        if (sourceTextArea) {
          textToPlay = sourceTextArea.value.substring(selectionInfo.startIndex);
        }
      } 
      
      // Fallback to searching for EPUB and other cases
      if (!textToPlay) {
          // For EPUB, re-get the current displayed text to ensure consistency
          const sourceText = activeDoc?.type === 'epub' && epubRenditionRef.current
            ? epubRenditionRef.current.getContents()?.[0]?.document?.body?.innerText || fullText
            : fullText;
  
          // Normalize both texts for a more reliable search
          const normalizedSource = sourceText.replace(/\s+/g, ' ');
          const normalizedSelection = selectionInfo.text.replace(/\s+/g, ' ');
          const searchIndex = normalizedSource.indexOf(normalizedSelection);
  
          if (searchIndex !== -1) {
              // Find the equivalent starting point in the original, non-normalized text
              const preSelectionText = sourceText.substring(0, searchIndex);
              const originalBreakCount = (preSelectionText.match(/\s+/g) || []).length;
              
              let currentBreakCount = 0;
              let originalStartIndex = 0;
              for(let i = 0; i < sourceText.length; i++) {
                  if (/\s/.test(sourceText[i])) {
                      currentBreakCount++;
                  }
                  if (currentBreakCount >= originalBreakCount) {
                      // This is a rough approximation, find the start of the word instead
                      let tempIndex = sourceText.indexOf(selectionInfo.text.split(/\s+/)[0], i);
                      originalStartIndex = tempIndex > -1 ? tempIndex : i;
                      break;
                  }
              }
              textToPlay = sourceText.substring(originalStartIndex);
          }
      }

      if (textToPlay) {
        _startSpeech(textToPlay, 'selection');
      } else {
        toast({
          variant: 'destructive',
          title: 'Could Not Play Selection',
          description: 'Could not find the selected text in the current document view. Playing selection only.',
        });
        _startSpeech(selectionInfo.text, 'selection');
      }
    }, 100);
  };


  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    if(!isMountedRef.current) return; stopSpeech(true); 
    setTtsSettings(prevSettings => {
        const newSettings = { ...prevSettings, [key]: value };
        if (key === 'engine') newSettings.type = value as 'local' | 'cloud';
        if (key === 'type') newSettings.engine = value as 'local' | 'cloud';
        LocalStorageService.saveTTSSettings(newSettings);
        return newSettings;
    });
  };

  const handleFavoriteSelection = () => {
    if (!isMountedRef.current) return;
    const selectionInfo = getSelectedText();
    const textToFavorite = selectionInfo.text || currentTextForTTS;
    
    if (textToFavorite) {
      const sourceName = activeDoc ? activeDoc.title : 'Scratchpad';
      const sourceId = activeDoc ? activeDoc.id : 'scratchpad';
      LocalStorageService.addFavoriteItem({
        id: Date.now().toString(),
        text: textToFavorite,
        sourceDocumentId: sourceId,
        sourceDocumentName: sourceName,
        createdAt: Date.now()
      });
      toast({ title: "Favorited!", description: `"${textToFavorite.substring(0, 50)}..." added.` });
    } else {
      toast({ variant: "destructive", title: "No Valid Text to Favorite", description: "Please ensure text is available to be favorited." });
    }
  };

  const navigatePdf = (direction: 'prev' | 'next') => {
    if (!pdfDocProxy || isRenderingPdfPage || isLoadingDoc) return;
    let newPage = currentPdfPageNum;
    if (direction === 'prev' && currentPdfPageNum > 1) newPage--;
    else if (direction === 'next' && currentPdfPageNum < pdfTotalPages) newPage++;
    else return; 
    if (newPage !== currentPdfPageNum) { stopSpeech(true); setCurrentPdfPageNum(newPage); }
  };

  const handlePdfScaleChange = (newScale: number) => { 
      if (isRenderingPdfPage || isLoadingDoc) return; 
      stopSpeech(true); 
      setPdfScale(newScale); 
  };

  const navigateEpub = async (direction: 'prev' | 'next') => {
    if (!epubRenditionRef.current || isEpubLoading) return;
    stopSpeech(true);
    try {
      if (direction === 'prev') {
        await epubRenditionRef.current.prev();
      } else {
        await epubRenditionRef.current.next();
      }
    } catch (error) {
        console.log(`[EPUB Nav] Error during rendition.${direction}():`, error);
        toast({ variant: "destructive", title: "EPUB Navigation Error", description: `Failed to turn page.` });
    }
  };

  const handleSwitchToScratchpad = async () => {
    stopSpeech(true);
    await IndexedDBService.saveLastActiveDocId(null);
    router.push('/reader');
  };

  const handleClearScratchpad = () => {
    if (!isMountedRef.current || activeDoc) return;
    stopSpeech(true);
    setScratchpadText('');
    setCurrentTextForTTS('');
    LocalStorageService.saveScratchpadText('');
    toast({ title: "Scratchpad Cleared" });
  };

  const getMainButtonState = () => {
    if (isLoadingTTS && speechOrigin === 'main') {
      return { text: "Loading...", icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, disabled: true };
    }
    if (isSpeaking && speechOrigin === 'main') {
      return isPaused 
        ? { text: "Resume", icon: <Play className="mr-1 h-4 w-4" />, disabled: false } 
        : { text: "Pause", icon: <Pause className="mr-1 h-4 w-4" />, disabled: false };
    }
    return { text: "Play Text", icon: <Play className="mr-1 h-4 w-4" />, disabled: false };
  };

  const getPlayFromSelectionButtonState = () => {
      if (isLoadingTTS && speechOrigin === 'selection') return { text: "Loading...", icon: <Loader2 className="mr-2 h-3 w-3 animate-spin" />};
      if (isSpeaking && speechOrigin === 'selection') {
        return isPaused 
          ? { text: "Resume", icon: <Play className="mr-2 h-3 w-3"/>}
          : { text: "Pause", icon: <Pause className="mr-2 h-3 w-3"/>};
      }
      return { text: "Play from Sel.", icon: <TextSelect className="mr-2 h-3 w-3"/>};
  }

  const mainButtonState = getMainButtonState();
  const playFromSelectionButtonState = getPlayFromSelectionButtonState();
  
  const showInitialLoader = isLoadingDoc && !activeDoc && !docErrorMessage;
  const showDocumentError = docErrorMessage && !activeDoc;
  
  if (showInitialLoader) { 
    return <div className="flex items-center justify-center h-full flex-grow"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-lg">Loading document...</p></div>; 
  }
  if (showDocumentError) { 
    return <div className="flex flex-col items-center justify-center h-full flex-grow p-4 text-center"> <AlertTriangle className="h-12 w-12 text-destructive mb-4" /> <h2 className="text-xl font-semibold mb-2">Error Loading Document</h2> <p className="text-muted-foreground mb-4">{docErrorMessage}</p> <Button onClick={() => router.push('/library')}>Go to Library</Button> </div>; 
  }
  
  const showOcrButtonForPdfPage = activeDoc?.type === 'pdf' && pdfPageImage && !isRenderingPdfPage && !isLoadingDoc && !isPerformingOcr && !pdfPageIsTextBased;
  const showOcrButtonForImage = activeDoc?.type === 'image' && displayedImageSrc && !isLoadingDoc && !isPerformingOcr && !(activeDoc as StoredImageDocument).extractedText;

  return (
    <div className="flex flex-col lg:flex-row w-full h-[calc(100vh-4rem)]">
      {/* Reader Content Pane */}
      <div className="flex-grow flex flex-col bg-muted/20 p-2 md:p-4 min-w-0">
        
        {/* Top part: Scrollable Content Area */}
        <div className="flex-grow overflow-y-auto rounded-lg bg-background shadow-inner relative flex flex-col items-center justify-start">
            {(isLoadingDoc || isEpubLoading || isRenderingPdfPage) && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="ml-3">Loading content...</p>
                </div>
            )}
            {docErrorMessage && !activeDoc && (
                <div className="absolute inset-x-0 top-4 mx-auto w-fit max-w-md bg-destructive/10 border border-destructive text-destructive p-3 rounded-md shadow-lg z-20 flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="font-medium text-sm">Document Display Issue</p>
                        <p className="text-xs">{docErrorMessage}</p>
                        <Button variant="ghost" size="sm" className="text-xs h-auto p-1 mt-1 text-destructive hover:bg-destructive/20" onClick={() => setDocErrorMessage(null)}>Dismiss</Button>
                    </div>
                </div>
            )}
            
            {/* Scratchpad View */}
            {!activeDoc && !isLoadingDoc && !docErrorMessage && (
              <div className="w-full h-full p-2 md:p-4 flex flex-col">
                  <Textarea
                      ref={mainTextAreaRef}
                      id="scratchpad-input"
                      placeholder="Welcome to the Scratchpad!

Type or paste any text here to have it read aloud or to save snippets to your favorites."
                      className="w-full flex-grow text-base resize-none"
                      value={scratchpadText}
                      onChange={(e) => {
                          setScratchpadText(e.target.value);
                          setCurrentTextForTTS(e.target.value);
                      }}
                      aria-label="Scratchpad for custom text input"
                  />
              </div>
            )}

            {/* PDF Content */}
            {activeDoc?.type === 'pdf' && (
                <div className="w-full text-center p-4 space-y-4">
                    {pdfPageImage && <NextImage src={pdfPageImage} alt={`Page ${currentPdfPageNum}`} width={0} height={0} style={{ width: 'auto', height: 'auto', maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} className="shadow-lg border rounded-md inline-block" />}
                    {showOcrButtonForPdfPage && (<Button onClick={handlePerformOcr} disabled={isPerformingOcr} className="mt-4"> {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR on PDF Page </Button> )}
                </div>
            )}
            
            {/* EPUB Content */}
            <div
                key={activeDoc?.id || 'epub-placeholder'}
                id="epub-viewer"
                ref={epubViewerRef}
                className={cn(
                    "w-full flex-grow", 
                    activeDoc?.type !== 'epub' && "hidden"
                )}
            />

            {/* TXT Content */}
            {activeDoc?.type === 'txt' && (
              <div className="w-full h-full p-2 md:p-4 flex flex-col">
                  <Textarea
                      ref={mainTextAreaRef}
                      readOnly
                      placeholder="Text document content..."
                      className="w-full flex-grow text-base resize-none"
                      value={txtContent}
                      aria-label="Text document content"
                  />
              </div>
            )}


            {/* Image Content */}
            {activeDoc?.type === 'image' && displayedImageSrc && (
                <div className="w-full text-center p-4 space-y-4">
                    <NextImage src={displayedImageSrc} alt={activeDoc.title || 'Uploaded Image'} width={800} height={600} style={{objectFit: 'contain'}} className="max-w-full max-h-[calc(100%-4rem)] shadow-lg border rounded-md inline-block" data-ai-hint="illustration abstract" />
                    {showOcrButtonForImage && <Button onClick={handlePerformOcr} disabled={isPerformingOcr} className="mt-4"> {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR on Image </Button> }
                </div>
            )}

            {/* Mobi Not Supported Message */}
            {activeDoc?.type === 'mobi' && ( <div className="p-4 bg-background rounded-md shadow-inner text-center h-full flex flex-col justify-center items-center"> <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2"/> <p className="font-semibold">MOBI Not Supported</p> <p className="text-sm text-muted-foreground">Please convert to EPUB or PDF.</p> </div> )}
        </div>

        {/* Bottom part: TTS Box - Fixed at the bottom of the content pane */}
        {activeDoc && !isLoadingDoc && (
            <div className="flex-shrink-0 pt-2">
                <Card className="shadow-md">
                    <CardHeader className="pb-1 pt-3">
                        <CardTitle className="text-sm flex items-center"><FileText className="mr-2 h-4 w-4"/> Current Text for TTS</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <textarea ref={ttsBoxTextAreaRef} readOnly value={currentTextForTTS} className="w-full h-20 p-2 border rounded-md bg-muted/30 text-xs select-text" placeholder="Text for TTS..." />
                    </CardContent>
                </Card>
            </div>
        )}
      </div>

      {/* Controls Sidebar */}
      <aside className="w-full lg:w-80 xl:w-96 border-l bg-background flex-shrink-0 overflow-y-auto">
        <div className="h-full p-3 pb-6 space-y-4">
            <Card>
                <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-base truncate flex items-center gap-1">
                        <BookOpen className="h-5 w-5 text-primary"/> {activeDoc?.title || "Scratchpad"}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {activeDoc
                        ? `Type: ${activeDoc.type?.toUpperCase()}${activeDoc?.type === 'pdf' && pdfTotalPages > 0 ? `, Page: ${currentPdfPageNum}/${pdfTotalPages}` : ''}`
                        : 'Custom text input'}
                    </CardDescription>
                </CardHeader>
                <CardContent className="pt-2">
                  <div className="flex w-full items-center gap-2">
                    <Button variant="outline" size="sm" className="flex-grow" onClick={handleSwitchToScratchpad} disabled={isLoadingDoc}>
                        <Edit className="mr-2 h-4 w-4" />
                        Switch to Scratchpad
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 flex-shrink-0"
                        onClick={handleClearScratchpad}
                        disabled={isLoadingDoc || !!activeDoc}
                        aria-label="Clear scratchpad text"
                        title="Clear scratchpad text"
                    >
                        <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
            </Card>

            {(activeDoc?.type === 'pdf' && pdfTotalPages > 0) && (
              <Card>
                <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">PDF Navigation & View</CardTitle></CardHeader>
                <CardContent className="space-y-2 pt-0">
                  <div className="flex items-center justify-between">
                    <Button onClick={() => navigatePdf('prev')} disabled={isLoadingDoc || isRenderingPdfPage || currentPdfPageNum <= 1} size="sm" variant="outline"><ChevronLeft /> Prev</Button>
                    <span className="text-sm tabular-nums"> {currentPdfPageNum} / {pdfTotalPages}</span>
                    <Button onClick={() => navigatePdf('next')} disabled={isLoadingDoc || isRenderingPdfPage || currentPdfPageNum >= pdfTotalPages} size="sm" variant="outline">Next <ChevronRight /></Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={() => handlePdfScaleChange(pdfScale - 0.25)} size="icon" variant="outline" className="h-7 w-7" disabled={isRenderingPdfPage || pdfScale <= 0.5}><ZoomOut className="h-4 w-4"/></Button>
                    <Slider value={[pdfScale]} min={0.5} max={3} step={0.25} onValueChange={([val]) => handlePdfScaleChange(val)} disabled={isRenderingPdfPage} />
                    <Button onClick={() => handlePdfScaleChange(pdfScale + 0.25)} size="icon" variant="outline" className="h-7 w-7" disabled={isRenderingPdfPage || pdfScale >=3}><ZoomIn className="h-4 w-4"/></Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeDoc?.type === 'epub' && (
              <Card>
                <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">EPUB Navigation</CardTitle></CardHeader>
                <CardContent className="flex items-center justify-between pt-0">
                    <Button onClick={() => navigateEpub('prev')} size="sm" variant="outline" disabled={isEpubLoading || isLoadingDoc}> <ChevronLeft /> Previous </Button>
                    <Button onClick={() => navigateEpub('next')} size="sm" variant="outline" disabled={isEpubLoading || isLoadingDoc}> Next <ChevronRight /> </Button>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm flex items-center gap-1"><Settings2 className="h-4 w-4"/> Text-to-Speech</CardTitle></CardHeader>
              <CardContent className="space-y-2 pt-0">
                <div>
                  <Label htmlFor="tts-engine" className="text-xs">Engine</Label>
                  <Select value={ttsSettings.engine} onValueChange={(v) => handleSettingChange('engine', v as 'local' | 'cloud')} disabled={isSpeaking && !isPaused}>
                    <SelectTrigger id="tts-engine" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="local"><div className="flex items-center gap-1 text-xs"><Smartphone className="h-3 w-3"/>Local</div></SelectItem><SelectItem value="cloud"><div className="flex items-center gap-1 text-xs"><CloudIcon className="h-3 w-3"/>Cloud</div></SelectItem></SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="tts-language" className="text-xs">Language</Label>
                  <Input id="tts-language" className="h-9 text-xs" value={ttsSettings.language} onChange={(e) => handleSettingChange('language', e.target.value)} disabled={isSpeaking && !isPaused} />
                </div>
                {ttsSettings.engine === 'local' && (
                  <div>
                    <Label htmlFor="tts-voice" className="text-xs">Voice (Local)</Label>
                    <Select value={ttsSettings.voiceURI || ""} onValueChange={(v) => handleSettingChange('voiceURI', v)} disabled={isSpeaking && !isPaused || availableVoices.length === 0}>
                      <SelectTrigger id="tts-voice" className="h-9 text-xs"><SelectValue placeholder="Select voice" /></SelectTrigger>
                      <SelectContent className="max-h-48">
                        {availableVoices.map(v => (<SelectItem key={v.voiceURI || v.name} value={v.voiceURI || ""} className="text-xs">{v.name} ({v.lang})</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1"><Label htmlFor="tts-rate" className="text-xs">Rate: {ttsSettings.rate.toFixed(1)}</Label><Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={isSpeaking && !isPaused}/></div>
                <div className="space-y-1"><Label htmlFor="tts-pitch" className="text-xs">Pitch: {ttsSettings.pitch.toFixed(1)}</Label><Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={isSpeaking && !isPaused}/></div>
                
                <Button onClick={playPauseSpeech} disabled={mainButtonState.disabled} variant={isSpeaking && !isPaused && speechOrigin === 'main' ? "outline" : "default"} className="w-full h-9 text-sm">{mainButtonState.icon} {mainButtonState.text}</Button>
                
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="w-full text-xs"> <Star className="mr-2 h-3 w-3" /> Favorite </Button>
                  <Button
                    onClick={handleRepeatSelection}
                    variant={isSpeaking && speechOrigin === 'repeat' ? "destructive" : "outline"}
                    size="sm"
                    className="w-full text-xs"
                    disabled={isLoadingTTS && speechOrigin !== 'repeat'}
                  >
                    {isSpeaking && speechOrigin === 'repeat' ? <X className="mr-2 h-3 w-3" /> : <Repeat className="mr-2 h-3 w-3" />}
                    {isSpeaking && speechOrigin === 'repeat' ? "Stop Repeat" : "Repeat Sel."}
                  </Button>
                </div>
                <Button 
                    onClick={handlePlayFromSelection} 
                    variant="outline" 
                    size="sm" 
                    className="w-full mt-2 text-xs"
                    disabled={isLoadingTTS && speechOrigin !== 'selection'}
                >
                    {playFromSelectionButtonState.icon}
                    {playFromSelectionButtonState.text}
                </Button>
              </CardContent>
            </Card>
        </div>
      </aside>
    </div>
  );
}

    