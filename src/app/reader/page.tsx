
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import NextImage from 'next/image';
import type { Book as EpubBook, Rendition } from 'epubjs'; // Ensure EpubBook and Rendition are typed
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
import type { TTSSettings, TTSVoice, StoredMangaDocument, ActiveMangaDocument, StoredPdfDocument, StoredImageDocument, StoredEpubDocument, StoredTxtDocument } from '@/types';
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

  // PDF specific states
  const [pdfDocProxy, setPdfDocProxy] = useState<PDFDocumentProxy | null>(null);
  const [currentPdfPageNum, setCurrentPdfPageNum] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfPageImage, setPdfPageImage] = useState<string | null>(null);
  const [isRenderingPdfPage, setIsRenderingPdfPage] = useState(false);
  const [pdfScale, setPdfScale] = useState(PDF_DEFAULT_SCALE);
  const [pdfPageIsTextBased, setPdfPageIsTextBased] = useState(true);

  // EPUB specific refs and state
  const epubBookRef = useRef<EpubBook | null>(null);
  const epubRenditionRef = useRef<Rendition | null>(null);
  const epubViewerRef = useRef<HTMLDivElement | null>(null);
  const [isEpubLoading, setIsEpubLoading] = useState(false);

  // TXT specific state
  const [txtContent, setTxtContent] = useState<string>("");

  // Image specific state
  const [displayedImageSrc, setDisplayedImageSrc] = useState<string | null>(null);
  const currentImageObjectUrlRef = useRef<string | null>(null);

  // OCR and TTS states
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
      utteranceRef.current.onend = null; utteranceRef.current.onboundary = null; utteranceRef.current.onerror = null; utteranceRef.current = null;
    }
    if (resetUIState) {
      setIsSpeaking(false); setIsPaused(false); setIsLoadingTTS(false);
    }
  }, []);

  // Effect to load document metadata (handles ALL document types initially)
  useEffect(() => {
    let isMounted = true;
    const loadDocumentMetadata = async () => {
      console.log("[ReaderPage] Main metadata load: Initiating.");
      if(isMounted) {
        stopSpeech(true);
        // Reset all document-specific states
        setPdfDocProxy(null); setCurrentPdfPageNum(1); setPdfTotalPages(0); setPdfPageImage(null); setPdfPageIsTextBased(true); setIsRenderingPdfPage(false);
        if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
        setDisplayedImageSrc(null);
        setTxtContent("");
        // EPUB refs are handled by its dedicated cleanup function.
        setCurrentTextForTTS("");
        setDocErrorMessage(null);
        setIsLoadingDoc(true); 
        setIsPerformingOcr(false);
        setIsEpubLoading(false);
      }

      let docIdToLoad = searchParams.get('docId');
      if (!docIdToLoad) {
        const lastActiveId = await IndexedDBService.getLastActiveDocId();
        if (lastActiveId) docIdToLoad = lastActiveId;
        else {
          if(isMounted) { setDocErrorMessage("No document selected. Please choose one from the Library."); setIsLoadingDoc(false); setActiveDoc(null); }
          return;
        }
      }
      if (!docIdToLoad) { 
         if(isMounted) { setDocErrorMessage("No document selected and no previously active document found."); setIsLoadingDoc(false); setActiveDoc(null); }
         return;
      }

      try {
        const doc = await IndexedDBService.getDocumentById(docIdToLoad);
        if (!doc) {
          if(isMounted) { setDocErrorMessage(`Document with ID "${docIdToLoad}" not found.`); await IndexedDBService.saveLastActiveDocId(null); setIsLoadingDoc(false); setActiveDoc(null); }
          return;
        }
        if(isMounted) { setActiveDoc(doc as ActiveMangaDocument); }
        await IndexedDBService.saveLastActiveDocId(docIdToLoad);
        // setIsLoadingDoc(false) will be handled by specific document type effects or the EPUB effect.
      } catch (err: any) {
        if(isMounted) { setDocErrorMessage(`Error loading document: ${err.message}`); setCurrentTextForTTS(`Error loading document: ${err.message}`); setIsLoadingDoc(false); setActiveDoc(null); }
      }
    };
    loadDocumentMetadata();
    return () => {
      isMounted = false;
      console.log("[ReaderPage] Main metadata load useEffect UNMOUNT/CLEANUP]: Stopping speech and cleaning up non-EPUB resources.");
      stopSpeech(true);
      if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
      if (pdfDocProxy) { try { pdfDocProxy.destroy(); } catch(e) { console.warn("Error destroying PDF proxy on main unmount", e);}}
      // EPUB cleanup is fully delegated to its dedicated effect.
    };
  }, [searchParams, router, stopSpeech]); 

  // PDF Loading Effect
  useEffect(() => {
    let isMounted = true;
    if (activeDoc?.type === 'pdf' && activeDoc.fileData) {
      if(isMounted) { setIsLoadingDoc(true); setCurrentTextForTTS("Loading PDF..."); setDocErrorMessage(null); }
      if (pdfDocProxy) { try { pdfDocProxy.destroy(); } catch(e){console.warn("Error destroying previous pdfDocProxy", e);}}
      if(isMounted) setPdfDocProxy(null);
      getDocument({ data: activeDoc.fileData.slice(0) }).promise.then(pdf => {
        if(!isMounted) { pdf.destroy(); return; }
        if(isMounted) { setPdfDocProxy(pdf); setPdfTotalPages(pdf.numPages); }
        const savedPageIndex = LocalStorageService.loadCurrentPdfPageIndexForDoc(activeDoc.id);
        const pageToLoad = (savedPageIndex && savedPageIndex > 0 && savedPageIndex <= pdf.numPages) ? savedPageIndex : 1;
        if(isMounted) setCurrentPdfPageNum(pageToLoad); 
      }).catch(e => {
        if(!isMounted) return;
        if(isMounted) { setDocErrorMessage(`Failed to load PDF: ${e.message}`); setCurrentTextForTTS(`Failed to load PDF: ${e.message}`); setIsLoadingDoc(false); }
      });
    } else if (activeDoc && activeDoc.type !== 'pdf' && pdfDocProxy) {
      try { pdfDocProxy.destroy(); } catch(e) { console.warn("Error destroying PDF proxy on doc type change", e); }
      if(isMounted) { setPdfDocProxy(null); setPdfTotalPages(0); setPdfPageImage(null); }
    }
    return () => { isMounted = false; }
  }, [activeDoc]);

  // PDF Page Rendering Effect
  useEffect(() => {
    let isMounted = true;
    if (activeDoc?.type === 'pdf' && pdfDocProxy && currentPdfPageNum > 0 && currentPdfPageNum <= pdfTotalPages) {
      if(isMounted) { stopSpeech(true); setIsRenderingPdfPage(true); setPdfPageImage(null); setPdfPageIsTextBased(true); setCurrentTextForTTS(`Loading PDF page ${currentPdfPageNum}...`); }
      LocalStorageService.saveCurrentPdfPageIndexForDoc(activeDoc.id, currentPdfPageNum);
      pdfDocProxy.getPage(currentPdfPageNum).then(async (page: PDFPageProxy) => {
        if(!isMounted) return;
        const viewport = page.getViewport({ scale: pdfScale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height; canvas.width = viewport.width;
        if (context) {
          await page.render({ canvasContext: context, viewport }).promise;
          if(isMounted) setPdfPageImage(canvas.toDataURL('image/png'));
        } else { throw new Error("Could not get canvas context for PDF rendering."); }
        const pdfDocFromState = activeDoc as StoredPdfDocument; 
        if (pdfDocFromState.ocrTextPerPage?.[currentPdfPageNum]) {
            if(isMounted) { setCurrentTextForTTS(pdfDocFromState.ocrTextPerPage[currentPdfPageNum]); setPdfPageIsTextBased(false); }
        } else {
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim();
            if (pageText && pageText.length >= MIN_PDF_TEXT_LENGTH_FOR_DIRECT_READ) {
                if(isMounted) { setCurrentTextForTTS(pageText); setPdfPageIsTextBased(true); }
            } else {
                if(isMounted) { setCurrentTextForTTS("This PDF page has no selectable text or is image-based. Use OCR to extract text for reading."); setPdfPageIsTextBased(false); }
            }
        }
        if(isMounted) setIsLoadingDoc(false); 
      }).catch(e => {
        if(!isMounted) return;
        if(isMounted) { setPdfPageImage(null); setCurrentTextForTTS(`Error rendering PDF page ${currentPdfPageNum}: ${e.message}`); setPdfPageIsTextBased(false); setIsLoadingDoc(false); }
      }).finally(() => {
        if(isMounted) setIsRenderingPdfPage(false);
      });
    }
     return () => { isMounted = false; }
  }, [pdfDocProxy, currentPdfPageNum, pdfTotalPages, pdfScale, activeDoc, stopSpeech]);

  // TXT File Loading Effect
  useEffect(() => {
    let isMounted = true;
    if (activeDoc?.type === 'txt' && activeDoc.fileData) {
        if(isMounted) { setIsLoadingDoc(true); setCurrentTextForTTS("Loading text file..."); setDocErrorMessage(null); }
        try {
            const decoder = new TextDecoder(); 
            const text = decoder.decode(activeDoc.fileData);
            if(isMounted) { setTxtContent(text); setCurrentTextForTTS(text); }
        } catch (e: any) {
            if(!isMounted) return;
            if(isMounted) { setDocErrorMessage(`Failed to decode TXT file: ${e.message}`); setCurrentTextForTTS(`Failed to decode TXT file: ${e.message}`); }
        } finally {
            if(isMounted) setIsLoadingDoc(false);
        }
    } else if (!activeDoc || activeDoc.type !== 'txt') {
      if(isMounted) setTxtContent(""); 
    }
    return () => { isMounted = false; }
  }, [activeDoc]);

  // Image File Loading Effect
  useEffect(() => {
    let isMounted = true;
    if (activeDoc?.type === 'image' && activeDoc.fileData) {
        if(isMounted) { setIsLoadingDoc(true); setCurrentTextForTTS("Loading image..."); setDocErrorMessage(null); }
        try {
            const blob = new Blob([activeDoc.fileData], { type: activeDoc.originalType });
            if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); }
            const newUrl = URL.createObjectURL(blob);
            currentImageObjectUrlRef.current = newUrl;
            if(isMounted) setDisplayedImageSrc(newUrl);
            const imageDoc = activeDoc as StoredImageDocument;
            if (imageDoc.extractedText) {
                if(isMounted) setCurrentTextForTTS(imageDoc.extractedText);
            } else {
                if(isMounted) setCurrentTextForTTS("Image loaded. Perform OCR to extract text for reading aloud.");
            }
        } catch (e: any) {
            if(!isMounted) return;
            if(isMounted) { setDocErrorMessage(`Failed to load image: ${e.message}`); setCurrentTextForTTS(`Failed to load image: ${e.message}`); }
        } finally {
            if(isMounted) setIsLoadingDoc(false);
        }
    } else if (!activeDoc || activeDoc.type !== 'image') {
        if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); }
        if(isMounted) setDisplayedImageSrc(null);
    }
     return () => { isMounted = false; }
  }, [activeDoc]);

  // NEW EPUB IMPLEMENTATION:
  const cleanupEpubInstances = useCallback(() => {
    console.log("[EPUB Cleanup] Attempting to cleanup EPUB instances.");
    let renditionDestroyed = false;
    if (epubRenditionRef.current) {
        console.log("[EPUB Cleanup] Found epubRenditionRef.current.");
        if (epubViewerRef.current && 
            document.body.contains(epubViewerRef.current) &&
            epubRenditionRef.current.manager && 
            epubRenditionRef.current.manager.container &&
            epubViewerRef.current.contains(epubRenditionRef.current.manager.container)
        ) {
            console.log("[EPUB Cleanup] Rendition container is valid. Calling rendition.destroy().");
            try {
                epubRenditionRef.current.destroy();
                renditionDestroyed = true;
            } catch (e: any) {
                console.error("[EPUB Cleanup] Error destroying EPUB rendition:", e.message || e);
            }
        } else {
            console.warn("[EPUB Cleanup] Rendition container no longer valid or viewer detached. Skipping rendition.destroy().");
        }
        epubRenditionRef.current = null;
    }

    if (epubBookRef.current) {
        console.log("[EPUB Cleanup] Found epubBookRef.current. Calling book.destroy().");
        try {
            epubBookRef.current.destroy();
        } catch (e: any) {
            console.error("[EPUB Cleanup] Error destroying EPUB book:", e.message || e);
        }
        epubBookRef.current = null;
    }

    if (epubViewerRef.current && document.body.contains(epubViewerRef.current)) {
        console.log("[EPUB Cleanup] Clearing epubViewerRef.current.innerHTML.");
        epubViewerRef.current.innerHTML = '';
    }
    console.log("[EPUB Cleanup] Finished. Rendition destroyed:", renditionDestroyed);
  }, []);

  useEffect(() => {
    let isMounted = true;
    
    const initializeNewEpub = async () => {
      if (!activeDoc || activeDoc.type !== 'epub' || !activeDoc.fileData) return;
      if (!epubViewerRef.current) {
        if (isMounted) {
          setDocErrorMessage("EPUB viewer element not available yet. Please wait or ensure it's rendered.");
          setIsLoadingDoc(true); // Keep general loading true if viewer not ready
        }
        console.warn("[EPUB Init] epubViewerRef.current is null. Cannot render EPUB.");
        return;
      }

      console.log("[EPUB Init] Starting initialization for doc:", activeDoc.id);
      if (isMounted) { 
        setIsLoadingDoc(true); 
        setIsEpubLoading(true); 
        setCurrentTextForTTS("Loading EPUB..."); 
        setDocErrorMessage(null); 
      }

      cleanupEpubInstances(); // Ensure clean state before new init

      try {
        const ePubModule = await import('epubjs');
        const EPub = ePubModule.default;

        const book = EPub(activeDoc.fileData);
        epubBookRef.current = book; // Assign to ref

        await book.ready;
        if (!isMounted) { console.warn("[EPUB Init] Unmounted during book.ready."); return; }
        console.log("[EPUB Init] Book ready for doc:", activeDoc.id);

        if (!epubViewerRef.current || !document.body.contains(epubViewerRef.current)) {
            console.error("[EPUB Init] epubViewerRef became unavailable after book.ready.");
            if (isMounted) { setDocErrorMessage("EPUB viewer became unavailable."); }
            cleanupEpubInstances(); // Attempt cleanup if viewer vanished
            if(isMounted) { setIsLoadingDoc(false); setIsEpubLoading(false); }
            return;
        }
        
        const rendition = book.renderTo(epubViewerRef.current, {
          width: "100%", height: "100%", flow: "paginated", spread: "none",
        });
        epubRenditionRef.current = rendition; // Assign to ref

        rendition.on('displayed', (section: any) => {
          if (!isMounted || epubRenditionRef.current !== rendition) return;
          try {
            const contents = section.contents || (section.document ? section.document.body : null);
            let text = "";
            if (contents) text = (contents.innerText || contents.textContent || "").replace(/\s+/g, ' ').trim();
            if (!text && section.output) { 
              const tempDiv = document.createElement('div'); tempDiv.innerHTML = section.output;
              text = (tempDiv.innerText || tempDiv.textContent || "").replace(/\s+/g, ' ').trim();
            }
            if (isMounted) setCurrentTextForTTS(text || "EPUB section loaded. Text may be graphical or empty.");
          } catch (textExtractError: any) {
            console.error("[EPUB Init] Error extracting text from EPUB section:", textExtractError);
            if (isMounted) setCurrentTextForTTS(`Error extracting EPUB text: ${textExtractError.message}`);
          }
        });
        
        await rendition.display();
        if (!isMounted) { console.warn("[EPUB Init] Unmounted during rendition.display."); return; }
        console.log("[EPUB Init] Rendition displayed for doc:", activeDoc.id);

      } catch (e: any) {
        console.error("[EPUB Init] Error during EPUB initialization for doc:", activeDoc.id, e);
        if (isMounted) {
          setDocErrorMessage(`Failed to load EPUB: ${e.message || String(e)}`);
          setCurrentTextForTTS(`Failed to load EPUB: ${e.message || String(e)}`);
        }
        cleanupEpubInstances(); // Cleanup on error
      } finally {
        if (isMounted) { setIsLoadingDoc(false); setIsEpubLoading(false); }
        console.log("[EPUB Init] Finished initialization attempt for doc:", activeDoc?.id);
      }
    };

    if (activeDoc && activeDoc.type === 'epub') {
      initializeNewEpub();
    } else {
      cleanupEpubInstances(); // Cleanup if not EPUB or no activeDoc
      // If not EPUB, ensure general loading state is false if it wasn't handled by other doc types
      if (isMounted && isLoadingDoc && (!activeDoc || (activeDoc.type !== 'pdf' && activeDoc.type !== 'image' && activeDoc.type !== 'txt'))) {
          setIsLoadingDoc(false); 
      }
    }
    return () => {
      isMounted = false;
      console.log("[EPUB Effect Cleanup] Unmounting or activeDoc changed. Running cleanupEpubInstances.");
      cleanupEpubInstances();
    };
  }, [activeDoc, cleanupEpubInstances]); // cleanupEpubInstances is stable due to useCallback


  const handlePerformOcr = useCallback(async () => {
    if (!activeDoc) { toast({ variant: "destructive", title: "OCR Error", description: "No active document." }); return; }
    stopSpeech(true);
    let dataUrlToProcess: string | null = null;
    const currentActiveDoc = activeDoc; 
    if (currentActiveDoc.type === 'pdf' && pdfPageImage && !pdfPageIsTextBased) { dataUrlToProcess = pdfPageImage; }
    else if (currentActiveDoc.type === 'image' && currentActiveDoc.fileData) {
        setIsPerformingOcr(true); 
        try {
            const docToProcess = await IndexedDBService.getDocumentById(currentActiveDoc.id) as StoredImageDocument | null;
            if (!docToProcess || !docToProcess.fileData || !docToProcess.originalType) {
                toast({variant: "destructive", title: "OCR Error", description: "Image data/type missing."}); setIsPerformingOcr(false); return;
            }
            dataUrlToProcess = await IndexedDBService.arrayBufferToBase64DataURL(docToProcess.fileData, docToProcess.originalType);
        } catch (conversionError: any) {
          toast({variant: "destructive", title: "OCR Error", description: `Image prep failed: ${conversionError.message}`}); setIsPerformingOcr(false); return;
        }
    }
    if (!dataUrlToProcess) { toast({ variant: "destructive", title: "OCR Error", description: "No image data for OCR." }); setIsPerformingOcr(false); return; }
    if(!isPerformingOcr) setIsPerformingOcr(true); 
    setCurrentTextForTTS("Performing OCR...");
    try {
        const result = await performOCR(dataUrlToProcess);
        if ('extractedText' in result) {
            const ocrText = result.extractedText || "OCR completed, no text found.";
            setCurrentTextForTTS(ocrText);
            const docFromDB = await IndexedDBService.getDocumentById(currentActiveDoc.id);
            if (!docFromDB) { toast({ variant: "destructive", title: "OCR Save Error", description: "Document disappeared." }); setIsPerformingOcr(false); return; }
            let updatedDocForSave: StoredMangaDocument = { ...docFromDB };
            if (updatedDocForSave.type === 'image') { (updatedDocForSave as StoredImageDocument).extractedText = ocrText; }
            else if (updatedDocForSave.type === 'pdf') {
                const ocrPages = { ...((updatedDocForSave as StoredPdfDocument).ocrTextPerPage || {}), [currentPdfPageNum]: ocrText };
                (updatedDocForSave as StoredPdfDocument).ocrTextPerPage = ocrPages; setPdfPageIsTextBased(false); 
            }
            await IndexedDBService.saveDocument(updatedDocForSave);
            setActiveDoc(updatedDocForSave as ActiveMangaDocument); 
        } else { setCurrentTextForTTS(`OCR Error: ${result.error}`); toast({ variant: "destructive", title: "OCR Error", description: result.error }); }
    } catch (e: any) { setCurrentTextForTTS(`OCR failed: ${e.message}`); toast({ variant: "destructive", title: "OCR Failed", description: e.message });
    } finally { setIsPerformingOcr(false); }
  }, [activeDoc, pdfPageImage, pdfPageIsTextBased, currentPdfPageNum, stopSpeech, toast]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const loadedSettings = LocalStorageService.loadTTSSettings();
      const engine = loadedSettings.engine || loadedSettings.type || 'local';
      setTtsSettings(prev => ({ ...prev, ...loadedSettings, type: engine, engine: engine }));
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
      if (typeof window !== 'undefined' && window.speechSynthesis) { window.speechSynthesis.onvoiceschanged = null; }
      stopSpeech(true); 
    };
  }, [populateVoiceList, stopSpeech]);

 useEffect(() => {
    let settingsToSave = { ...ttsSettings }; 
    let changesMadeToSettingsState = false;
    if (typeof window !== 'undefined' && window.speechSynthesis && settingsToSave.engine === 'local') {
        const systemVoices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService, default: v.default }));
        if (systemVoices.length > 0) {
            let voiceToSet: TTSVoice | undefined = settingsToSave.voiceURI ? systemVoices.find(v => v.voiceURI === settingsToSave.voiceURI) : undefined;
            let langToSet = settingsToSave.language; 
            const currentVoiceIsValidForLanguage = voiceToSet && voiceToSet.lang && (voiceToSet.lang === settingsToSave.language || voiceToSet.lang.startsWith(settingsToSave.language.split('-')[0]));
            if (!voiceToSet || !currentVoiceIsValidForLanguage) {
                const defaultForLang = systemVoices.find(v => v.lang === settingsToSave.language && v.default) || systemVoices.find(v => v.lang === settingsToSave.language) || systemVoices.find(v => v.lang?.startsWith(settingsToSave.language.split('-')[0]) && v.default) || systemVoices.find(v => v.lang?.startsWith(settingsToSave.language.split('-')[0]));
                if (defaultForLang && defaultForLang.lang) { voiceToSet = defaultForLang; langToSet = defaultForLang.lang;  }
                else { const absoluteFallback = systemVoices.find(v => v.default && v.lang) || (systemVoices.length > 0 ? systemVoices[0] : undefined); if (absoluteFallback && absoluteFallback.lang) { voiceToSet = absoluteFallback; langToSet = absoluteFallback.lang; } else { voiceToSet = undefined; } }
            }
            const newVoiceURI = voiceToSet ? voiceToSet.voiceURI : undefined;
            if (newVoiceURI !== settingsToSave.voiceURI) { settingsToSave.voiceURI = newVoiceURI; changesMadeToSettingsState = true; }
            if (langToSet && langToSet !== settingsToSave.language) { settingsToSave.language = langToSet; changesMadeToSettingsState = true; }
        } else { if(settingsToSave.voiceURI !== undefined) { settingsToSave.voiceURI = undefined; changesMadeToSettingsState = true; } }
    } else if (settingsToSave.engine === 'cloud') { if (settingsToSave.voiceURI !== undefined) { settingsToSave.voiceURI = undefined; changesMadeToSettingsState = true; } }
    if (changesMadeToSettingsState || settingsToSave.rate !== ttsSettings.rate || settingsToSave.pitch !== ttsSettings.pitch ) {
      if(changesMadeToSettingsState) { setTtsSettings(settingsToSave); }
      LocalStorageService.saveTTSSettings(settingsToSave); 
    }
}, [ttsSettings.engine, ttsSettings.language, ttsSettings.voiceURI, availableVoices, ttsSettings.rate, ttsSettings.pitch, ttsSettings]); // Keep ttsSettings as a whole for initial comparison

  useEffect(() => {
    const player = new Audio(); audioPlayerRef.current = player; 
    const handleAudioEnded = () => { if (audioPlayerRef.current === player && isSpeaking && ttsSettings.engine === 'cloud') stopSpeech(true); };
    const handleAudioPlaying = () => { if (audioPlayerRef.current === player && ttsSettings.engine === 'cloud' && isSpeaking) setIsLoadingTTS(false); };
    const handleAudioError = (e: Event) => { if (audioPlayerRef.current === player && isSpeaking && ttsSettings.engine === 'cloud') { toast({variant: "destructive", title: "Audio Error", description: "Failed to play cloud TTS audio."}); stopSpeech(true); }};
    player.addEventListener('ended', handleAudioEnded); player.addEventListener('playing', handleAudioPlaying); player.addEventListener('error', handleAudioError);
    return () => {
        player.removeEventListener('ended', handleAudioEnded); player.removeEventListener('playing', handleAudioPlaying); player.removeEventListener('error', handleAudioError);
        if (player.src && !player.paused) player.pause(); player.src = ""; 
        if (audioPlayerRef.current === player) audioPlayerRef.current = null;
    };
  }, [ttsSettings.engine, isSpeaking, stopSpeech, toast]); 

  const playPauseSpeech = async () => {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    const selectedTextFromSelection = selection?.toString().trim();
    const effectiveTextToRead = selectedTextFromSelection || currentTextForTTS;
    const invalidMessages = [ "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...", "Image loaded. Perform OCR", "No text content found", "Could not extract text", "EPUB viewer element not ready", "This PDF page has no selectable text", "Performing OCR...", "No document ID provided", "Document with ID", "EPUB viewer became unavailable.", "OCR completed, but no text found.", "No document selected.", "EPUB section loaded. Text may be graphical or empty." ];
    if (!effectiveTextToRead || invalidMessages.some(msg => effectiveTextToRead.startsWith(msg)) || effectiveTextToRead.length < MIN_TTS_TEXT_LENGTH) {
      toast({ variant: "destructive", title: "No Valid Text", description: `No valid text to read or text too short (min ${MIN_TTS_TEXT_LENGTH} chars).` }); return;
    }
    if (isSpeaking) {
      if (isPaused) { 
        if (ttsSettings.engine === 'local' && utteranceRef.current && window.speechSynthesis?.paused) { window.speechSynthesis.resume(); setIsPaused(false); }
        else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current?.paused) { audioPlayerRef.current.play().then(() => setIsPaused(false)).catch(() => stopSpeech(true)); }
      } else { 
        if (ttsSettings.engine === 'local' && utteranceRef.current && window.speechSynthesis?.speaking) { window.speechSynthesis.pause(); setIsPaused(true); }
        else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current && !audioPlayerRef.current.paused) { audioPlayerRef.current.pause(); setIsPaused(true); }
      }
    } else { 
      stopSpeech(false); setIsLoadingTTS(true); setIsSpeaking(true); setIsPaused(false);
      if (ttsSettings.engine === 'local') {
        if (typeof window === 'undefined' || !window.speechSynthesis) { toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." }); stopSpeech(true); return; }
        const utterance = new SpeechSynthesisUtterance(effectiveTextToRead);
        utterance.lang = ttsSettings.language; utterance.pitch = ttsSettings.pitch; utterance.rate = ttsSettings.rate;
        const systemVoices = window.speechSynthesis.getVoices(); let voiceToUse: SpeechSynthesisVoice | undefined = undefined;
        if (systemVoices.length > 0) {
            if (ttsSettings.voiceURI) voiceToUse = systemVoices.find(v => v.voiceURI === ttsSettings.voiceURI && v.lang.startsWith(ttsSettings.language.split('-')[0]));
            if (!voiceToUse && ttsSettings.language) voiceToUse = systemVoices.find(v => v.lang === ttsSettings.language && v.default) || systemVoices.find(v => v.lang === ttsSettings.language) || systemVoices.find(v => v.lang?.startsWith(ttsSettings.language.split('-')[0]) && v.default) || systemVoices.find(v => v.lang?.startsWith(ttsSettings.language.split('-')[0]));
            if (!voiceToUse) voiceToUse = systemVoices.find(v => v.default && v.lang) || (systemVoices.length > 0 ? systemVoices[0] : undefined);
        }
        if (voiceToUse) utterance.voice = voiceToUse; else if (availableVoices.length === 0 && systemVoices.length === 0) { toast({variant: "destructive", title: "TTS Error", description: "No speech synthesis voices available."}); stopSpeech(true); return; }
        utterance.onend = () => { if(utteranceRef.current === utterance) stopSpeech(true); };
        utterance.onerror = (event) => { if(utteranceRef.current === utterance) { toast({ variant: "destructive", title: "TTS Error", description: event.error || "Speech failed." }); stopSpeech(true); }};
        utteranceRef.current = utterance; window.speechSynthesis.speak(utterance); setIsLoadingTTS(false); 
      } else { 
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
    setTtsSettings(prevSettings => {
        let newSettings = { ...prevSettings, [key]: value };
        if (key === 'engine') newSettings.type = value as 'local' | 'cloud'; 
        if (key === 'type') newSettings.engine = value as 'local' | 'cloud'; 
        if ((key === 'engine' || key === 'type') && newSettings.engine === 'cloud') newSettings.voiceURI = undefined;
        return newSettings;
    });
  };

  const handleFavoriteSelection = () => {
    const selection = window.getSelection()?.toString().trim() || currentTextForTTS;
    const invalidMessages = [ "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...", "Image loaded. Perform OCR", "No text content found", "Could not extract text", "EPUB viewer element not ready", "This PDF page has no selectable text", "Performing OCR...", "No document ID provided", "Document with ID", "EPUB viewer became unavailable.", "OCR completed, but no text found.", "No document selected.", "EPUB section loaded. Text may be graphical or empty."];
    if (selection && activeDoc && !invalidMessages.some(msg => selection.startsWith(msg)) && selection.length >= MIN_TTS_TEXT_LENGTH) {
      LocalStorageService.addFavoriteItem({ id: Date.now().toString(), text: selection, sourceDocumentId: activeDoc.id, sourceDocumentName: activeDoc.title, createdAt: Date.now() });
      toast({ title: "Favorited!", description: `"${selection.substring(0,50)}..." added.`});
    } else {
      toast({ variant: "destructive", title: "No Valid Text", description: `Ensure valid text (min ${MIN_TTS_TEXT_LENGTH} chars) is available or selected.` });
    }
  };

  const navigatePdf = (direction: 'prev' | 'next') => {
    if (!pdfDocProxy || isRenderingPdfPage) return;
    let newPage = currentPdfPageNum;
    if (direction === 'prev' && currentPdfPageNum > 1) newPage--;
    if (direction === 'next' && currentPdfPageNum < pdfTotalPages) newPage++;
    if (newPage !== currentPdfPageNum) { stopSpeech(true); setCurrentPdfPageNum(newPage); }
  };
  const handlePdfScaleChange = (newScale: number) => { if (isRenderingPdfPage) return; stopSpeech(true); setPdfScale(newScale); };

  const navigateEpub = (direction: 'prev' | 'next') => {
    if (!epubRenditionRef.current || isLoadingDoc || isEpubLoading || !epubViewerRef.current || !epubRenditionRef.current.manager?.active ) {
        console.warn("[EPUB Nav] Cannot navigate. Conditions not met."); return;
    }
    stopSpeech(true); 
    if (direction === 'prev') epubRenditionRef.current.prev(); else epubRenditionRef.current.next();
  };

  const getButtonState = () => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const effectiveText = selectedText || currentTextForTTS;
    const invalidMessages = [ "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...", "Image loaded. Perform OCR", "No text content found", "Could not extract text", "EPUB viewer element not ready", "This PDF page has no selectable text", "Performing OCR...", "No document ID provided", "Document with ID", "EPUB viewer became unavailable.", "OCR completed, but no text found.", "No document selected.", "EPUB section loaded. Text may be graphical or empty."];
    const canPlay = !!(effectiveText && !invalidMessages.some(msg => effectiveText.startsWith(msg)) && effectiveText.length >= MIN_TTS_TEXT_LENGTH && activeDoc && !isLoadingDoc && !isPerformingOcr && !isRenderingPdfPage && !docErrorMessage && !isEpubLoading);
    if (isLoadingTTS) return { text: "Loading...", icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, disabled: true };
    if (isSpeaking && !isPaused) return { text: "Pause", icon: <Pause className="mr-1 h-4 w-4" />, disabled: false };
    if (isSpeaking && isPaused) return { text: "Resume", icon: <Play className="mr-1 h-4 w-4" />, disabled: false };
    return { text: selectedText ? "Play Selected" : "Play Text", icon: <Play className="mr-1 h-4 w-4" />, disabled: !canPlay };
  };
  const buttonState = getButtonState();

  if (isLoadingDoc && !activeDoc && !docErrorMessage && !isEpubLoading) {
    return <div className="flex items-center justify-center h-full flex-grow"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-lg">Loading document...</p></div>;
  }
  if (docErrorMessage && (!activeDoc || (activeDoc && !['pdf', 'epub', 'txt', 'image'].includes(activeDoc.type))) ) {
    return <div className="flex flex-col items-center justify-center h-full flex-grow p-4 text-center"> <AlertTriangle className="h-12 w-12 text-destructive mb-4" /> <h2 className="text-xl font-semibold mb-2">Error Loading Document</h2> <p className="text-muted-foreground mb-4">{docErrorMessage}</p> <Button onClick={() => router.push('/library')}>Go to Library</Button> </div>;
  }
  const showOcrButtonForPdfPage = activeDoc?.type === 'pdf' && !pdfPageIsTextBased && pdfPageImage && !isRenderingPdfPage && !isLoadingDoc && !isPerformingOcr;
  const showOcrButtonForImage = activeDoc?.type === 'image' && displayedImageSrc && !isLoadingDoc && !isPerformingOcr && !(activeDoc as StoredImageDocument).extractedText;

  return (
    <div className="flex flex-col lg:flex-row w-full h-[calc(100vh-4rem)]"> 
      <div className="flex-grow overflow-y-auto bg-muted/20 p-2 md:p-4 relative">
         {docErrorMessage && activeDoc && (activeDoc.type === 'epub' || activeDoc.type === 'pdf') && (
            <div className="absolute inset-x-0 top-4 mx-auto w-fit max-w-md bg-destructive/10 border border-destructive text-destructive p-3 rounded-md shadow-lg z-10 flex items-start gap-2"> <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" /> <div> <p className="font-medium text-sm">Document Display Issue</p> <p className="text-xs">{docErrorMessage}</p> <Button variant="ghost" size="sm" className="text-xs h-auto p-1 mt-1 text-destructive hover:bg-destructive/20" onClick={() => setDocErrorMessage(null)}>Dismiss</Button> </div> </div>
        )}
        {isLoadingDoc && (activeDoc?.type === 'pdf' || activeDoc?.type === 'image' || activeDoc?.type === 'txt') && !docErrorMessage && !isEpubLoading &&
            <div className="flex items-center justify-center h-full"> <Loader2 className="h-10 w-10 animate-spin text-primary" /><p className="ml-3">Loading content for {activeDoc.type.toUpperCase()}...</p> </div>
        }
        {!isLoadingDoc && activeDoc?.type === 'pdf' && (
          <div className="flex flex-col items-center">
            {isRenderingPdfPage && !pdfPageImage && <Loader2 className="h-10 w-10 animate-spin my-8 text-primary" />}
            {pdfPageImage && <NextImage src={pdfPageImage} alt={`Page ${currentPdfPageNum}`} width={0} height={0} sizes="100vw" style={{ width: 'auto', height: 'auto', maxHeight: 'calc(100vh - 12rem)', maxWidth: '100%', objectFit: 'contain' }} className="shadow-lg border rounded-md" />}
            {!pdfPageImage && !isRenderingPdfPage && !docErrorMessage && (pdfDocProxy && pdfTotalPages > 0) && <div className="my-8 text-muted-foreground">{`Waiting for page ${currentPdfPageNum} to render...`}</div> }
            {showOcrButtonForPdfPage && (<Button onClick={handlePerformOcr} disabled={isPerformingOcr} className="mt-3"> {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR on PDF Page </Button> )}
          </div>
        )}
        {/* EPUB Viewer Area */}
        {activeDoc?.type === 'epub' && (
            <div ref={epubViewerRef} className={cn("w-full h-full epub-viewer-container bg-background rounded-md shadow-inner", (isLoadingDoc || isEpubLoading) && "flex items-center justify-center", !isEpubLoading && docErrorMessage && activeDoc.type === 'epub' && "p-4 text-center" )}>
                {(isLoadingDoc || isEpubLoading) && !docErrorMessage && <Loader2 className="h-10 w-10 animate-spin text-primary" />}
                {!isEpubLoading && docErrorMessage && activeDoc.type === 'epub' && 
                  <div className="text-destructive"> <AlertTriangle className="h-8 w-8 mx-auto mb-2"/> <p className="font-semibold">EPUB Load Error</p> <p className="text-sm">{docErrorMessage}</p> </div>
                }
            </div>
        )}
        {!isLoadingDoc && activeDoc?.type === 'txt' && (
          <pre className="whitespace-pre-wrap p-4 bg-background rounded-md shadow-inner text-sm font-mono h-full overflow-y-auto select-text">{txtContent}</pre>
        )}
        {!isLoadingDoc && activeDoc?.type === 'image' && displayedImageSrc && (
            <div className="flex flex-col items-center">
                <NextImage src={displayedImageSrc} alt={activeDoc.title || 'Uploaded Image'} width={800} height={600} style={{objectFit: 'contain'}} className="max-w-full max-h-[calc(100vh-15rem)] shadow-lg border rounded-md" />
                {showOcrButtonForImage && <Button onClick={handlePerformOcr} disabled={isPerformingOcr} className="mt-3"> {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR on Image </Button> }
            </div>
        )}
         {!isLoadingDoc && activeDoc?.type === 'mobi' && (
           <div className="p-4 bg-background rounded-md shadow-inner text-center h-full flex flex-col justify-center items-center"> <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2"/> <p className="font-semibold">MOBI File Format Not Supported</p> <p className="text-sm text-muted-foreground">Please convert to EPUB or PDF.</p> </div>
         )}
        { (activeDoc?.type === 'pdf' || activeDoc?.type === 'epub' || activeDoc?.type === 'image' || activeDoc?.type === 'txt') && currentTextForTTS && !docErrorMessage && !isLoadingDoc && !isRenderingPdfPage && !isPerformingOcr && !isEpubLoading &&
            <Card className="mt-4 sticky bottom-2 bg-background/90 backdrop-blur-sm shadow-md"> <CardHeader className="pb-1 pt-3"> <CardTitle className="text-sm flex items-center"><FileText className="mr-2 h-4 w-4"/> Current Text for TTS</CardTitle> </CardHeader> <CardContent className="pt-0"> <textarea readOnly value={currentTextForTTS} className="w-full h-20 p-2 border rounded-md bg-muted/30 text-xs select-text" placeholder="Text for TTS..." /> </CardContent> </Card>
        }
      </div>
      <div className="w-full lg:w-80 xl:w-96 p-3 border-l bg-background flex-shrink-0 overflow-y-auto space-y-4">
        <Card>
            <CardHeader className="pb-2 pt-4"> <CardTitle className="text-base truncate flex items-center gap-1"> <BookOpen className="h-5 w-5 text-primary"/> {activeDoc?.title || "No Document Loaded"} </CardTitle>
                {activeDoc && <CardDescription className="text-xs">Type: {activeDoc.type.toUpperCase()}{activeDoc.type === 'pdf' && pdfTotalPages > 0 ? `, Page: ${currentPdfPageNum}/${pdfTotalPages}` : ''}{activeDoc.type === 'epub' && (isLoadingDoc || isEpubLoading) ? ` (Loading EPUB...)`: ''}</CardDescription>}
                {!activeDoc && !isLoadingDoc && !docErrorMessage && <CardDescription className="text-xs">No document loaded.</CardDescription>}
                {docErrorMessage && (!activeDoc || (activeDoc && (activeDoc.type === 'epub' || activeDoc.type === 'pdf'))) && <CardDescription className="text-xs text-destructive">{docErrorMessage}</CardDescription>}
            </CardHeader>
        </Card>
        {(activeDoc?.type === 'pdf' && pdfTotalPages > 0) && (
          <Card> <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">PDF Navigation & View</CardTitle></CardHeader> <CardContent className="space-y-2 pt-0"> <div className="flex items-center justify-between"> <Button onClick={() => navigatePdf('prev')} disabled={currentPdfPageNum <= 1 || isRenderingPdfPage || isLoadingDoc} size="sm" variant="outline"><ChevronLeft /> Prev</Button> <span className="text-sm tabular-nums"> {currentPdfPageNum} / {pdfTotalPages}</span> <Button onClick={() => navigatePdf('next')} disabled={currentPdfPageNum >= pdfTotalPages || isRenderingPdfPage || isLoadingDoc} size="sm" variant="outline">Next <ChevronRight /></Button> </div> <div className="flex items-center gap-2"> <Button onClick={() => handlePdfScaleChange(pdfScale - 0.25)} size="icon" variant="outline" className="h-7 w-7" disabled={isRenderingPdfPage || pdfScale <= 0.5 || isLoadingDoc}><ZoomOut className="h-4 w-4"/></Button> <Slider value={[pdfScale]} min={0.5} max={3} step={0.25} onValueChange={([val]) => handlePdfScaleChange(val)} disabled={isRenderingPdfPage || isLoadingDoc} /> <Button onClick={() => handlePdfScaleChange(pdfScale + 0.25)} size="icon" variant="outline" className="h-7 w-7" disabled={isRenderingPdfPage || pdfScale >=3 || isLoadingDoc}><ZoomIn className="h-4 w-4"/></Button> </div> </CardContent> </Card>
        )}
        {activeDoc?.type === 'epub' && (
          <Card> <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">EPUB Navigation</CardTitle></CardHeader> <CardContent className="flex items-center justify-between pt-0"> <Button onClick={() => navigateEpub('prev')} size="sm" variant="outline" disabled={isLoadingDoc || isEpubLoading || !epubRenditionRef.current}><ChevronLeft /> Previous</Button> <Button onClick={() => navigateEpub('next')} size="sm" variant="outline" disabled={isLoadingDoc || isEpubLoading || !epubRenditionRef.current}>Next <ChevronRight /></Button> </CardContent> </Card>
        )}
        <Card>
          <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm flex items-center gap-1"><Settings2 className="h-4 w-4"/> Text-to-Speech</CardTitle></CardHeader>
          <CardContent className="space-y-2 pt-0">
            <div> <Label htmlFor="tts-engine" className="text-xs">Engine</Label> <Select value={ttsSettings.engine} onValueChange={(v) => handleSettingChange('engine', v as 'local' | 'cloud')} disabled={(isSpeaking && !isPaused) || isLoadingDoc || isRenderingPdfPage || isPerformingOcr || isEpubLoading}> <SelectTrigger id="tts-engine" className="h-9 text-xs"><SelectValue /></SelectTrigger> <SelectContent><SelectItem value="local"><div className="flex items-center gap-1 text-xs"><Smartphone className="h-3 w-3"/>Local</div></SelectItem><SelectItem value="cloud"><div className="flex items-center gap-1 text-xs"><CloudIcon className="h-3 w-3"/>Cloud</div></SelectItem></SelectContent> </Select> </div>
            <div> <Label htmlFor="tts-language" className="text-xs">Language</Label> <Input id="tts-language" className="h-9 text-xs" value={ttsSettings.language} onChange={(e) => handleSettingChange('language', e.target.value)} disabled={(isSpeaking && !isPaused) || (ttsSettings.engine === 'local' && availableVoices.length === 0) || isLoadingDoc || isRenderingPdfPage || isPerformingOcr || isEpubLoading} /> </div>
            {ttsSettings.engine === 'local' && (
              <div> <Label htmlFor="tts-voice" className="text-xs">Voice (Local)</Label> <Select value={ttsSettings.voiceURI || ""} onValueChange={(v) => handleSettingChange('voiceURI', v)} disabled={(isSpeaking && !isPaused) || availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 || isLoadingDoc || isRenderingPdfPage || isPerformingOcr || isEpubLoading}> <SelectTrigger id="tts-voice" className="h-9 text-xs"><SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No voices"} /></SelectTrigger> <SelectContent className="max-h-48"> {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).map(v => (<SelectItem key={v.voiceURI || v.name} value={v.voiceURI || ""} className="text-xs">{v.name} ({v.lang})</SelectItem>))} {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (<SelectItem value="no-voice-reader" disabled className="text-xs">{availableVoices.length > 0 ? "No voices for lang" : "No local voices"}</SelectItem>)} </SelectContent> </Select> </div>
            )}
            <div className="space-y-1"><Label htmlFor="tts-rate" className="text-xs">Rate: {ttsSettings.rate.toFixed(1)}</Label><Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={(isSpeaking && !isPaused) || isLoadingDoc || isRenderingPdfPage || isPerformingOcr || isEpubLoading}/></div>
            <div className="space-y-1"><Label htmlFor="tts-pitch" className="text-xs">Pitch: {ttsSettings.pitch.toFixed(1)}</Label><Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={(isSpeaking && !isPaused) || isLoadingDoc || isRenderingPdfPage || isPerformingOcr || isEpubLoading}/></div>
            <Button onClick={playPauseSpeech} disabled={buttonState.disabled} variant={isSpeaking && !isPaused ? "outline" : "default"} className="w-full h-9 text-sm">{buttonState.icon} {buttonState.text}</Button>
            <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="w-full mt-2 text-xs" disabled={!activeDoc || isLoadingDoc || isPerformingOcr || isRenderingPdfPage || docErrorMessage || isEpubLoading}><Star className="mr-2 h-3 w-3" /> Favorite Text/Selection</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

    