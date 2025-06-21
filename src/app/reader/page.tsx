
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import NextImage from 'next/image';
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
import type { TTSSettings, TTSVoice, StoredMangaDocument, ActiveMangaDocument, StoredPdfDocument, StoredImageDocument, StoredEpubDocument, StoredTxtDocument, StoredMobiDocument } from '@/types';
import { cn } from '@/lib/utils';

const PDF_DEFAULT_SCALE = 1.5;
const MIN_PDF_TEXT_LENGTH_FOR_DIRECT_READ = 20;
const MIN_TTS_TEXT_LENGTH = 5;

type EpubBook = import('epubjs').Book;
type Rendition = import('epubjs').Rendition;

export default function ReaderPage() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeDoc, setActiveDoc] = useState<ActiveMangaDocument | null>(null);
  const [isLoadingDoc, setIsLoadingDoc] = useState(true); // General doc loading, or EPUB initial load before first section
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
  const epubBookRef = useRef<EpubBook | null>(null);
  const epubRenditionRef = useRef<Rendition | null>(null);
  const [isEpubLoading, setIsEpubLoading] = useState(false); // Specific to epubjs internal setup
  const [isEpubSectionDisplayed, setIsEpubSectionDisplayed] = useState(false); // True when epubjs confirms section render

  // TXT and Image states
  const [txtContent, setTxtContent] = useState<string>("");
  const [displayedImageSrc, setDisplayedImageSrc] = useState<string | null>(null);
  const currentImageObjectUrlRef = useRef<string | null>(null); // For revoking image object URLs

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

  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    if (typeof window !== 'undefined' && !GlobalWorkerOptions.workerSrc) {
      GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
    }
    return () => {
      isMountedRef.current = false;
    };
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
    if (resetUIState && isMountedRef.current) {
      setIsSpeaking(false); setIsPaused(false); setIsLoadingTTS(false);
    }
  }, []);

  const cleanupEpubInstances = useCallback(async () => {
    console.log("[EPUB Cleanup] Initiating cleanup of EPUB instances.");
    stopSpeech(true);

    const renditionToDestroy = epubRenditionRef.current;
    const bookToDestroy = epubBookRef.current;

    // Nullify React refs immediately
    epubRenditionRef.current = null;
    epubBookRef.current = null;

    if (renditionToDestroy) {
        console.log("[EPUB Cleanup] Scheduling rendition.destroy() for captured rendition.");
        requestAnimationFrame(() => {
            if (!isMountedRef.current) { console.warn("[EPUB Cleanup/rAF] Component unmounted before rendition.destroy() could execute."); return; }
            if (renditionToDestroy.manager && typeof renditionToDestroy.destroy === 'function') {
                try {
                    renditionToDestroy.destroy();
                    console.log("[EPUB Cleanup/rAF] rendition.destroy() completed for captured rendition.");
                } catch (e: any) {
                    console.warn("[EPUB Cleanup/rAF] Error during rendition.destroy() (caught):", e.message || e);
                }
            } else {
                console.warn("[EPUB Cleanup/rAF] Rendition manager was undefined or destroy method missing. Skipping rendition.destroy().");
            }
        });
    }

    if (bookToDestroy) {
        console.log("[EPUB Cleanup] Attempting to destroy captured book instance.");
        if (typeof bookToDestroy.destroy === 'function') {
            try { bookToDestroy.destroy(); console.log("[EPUB Cleanup] Captured book instance destroyed."); } catch (e: any) { console.warn("[EPUB Cleanup] Error destroying captured book instance (caught):", e.message || e); }
        } else {
           console.warn("[EPUB Cleanup] Captured book instance did not have a .destroy() method.");
        }
    }

    if (isMountedRef.current) {
      setIsEpubSectionDisplayed(false);
      setCurrentTextForTTS("");
    }
  }, [stopSpeech]);
  
  const initializeNewEpub = useCallback(async (docToInit: StoredEpubDocument) => {
    if (!isMountedRef.current || !docToInit || !docToInit.fileData) {
      if (isMountedRef.current) setDocErrorMessage("EPUB initialization prerequisites failed.");
      return;
    }
    if (!epubViewerRef.current) {
      if (isMountedRef.current) setDocErrorMessage("EPUB viewer element could not be found. Please reload.");
      setIsEpubLoading(false); setIsLoadingDoc(false);
      return;
    }
    
    epubViewerRef.current.innerHTML = '';
    console.log(`[EPUB Init] Starting for doc: ${docToInit.id}, Title: "${docToInit.title}".`);
    if(isMountedRef.current) setDocErrorMessage(null);

    let book: EpubBook | null = null;
    let rendition: Rendition | null = null;

    try {
      const ePubModule = await import('epubjs');
      const EPub = ePubModule.default;

      book = EPub(docToInit.fileData, { bookPath: docToInit.id });
      epubBookRef.current = book;
      await book.ready;
      console.log("[EPUB Init] Book is ready for:", docToInit.id);

      if (!isMountedRef.current || epubBookRef.current !== book || activeDoc?.id !== docToInit.id) {
         console.warn("[EPUB Init] Stale init detected after book.ready for doc:", docToInit.id);
         if (book) try { book.destroy(); } catch(e){ console.warn("Book destroyed due to stale init for doc:", docToInit.id, e);}
         return;
      }
      if (!epubViewerRef.current) { throw new Error("EPUB viewer detached before rendering."); }

      rendition = book.renderTo(epubViewerRef.current, { width: "100%", height: "100%", flow: "paginated", spread: "auto" });
      epubRenditionRef.current = rendition;

      rendition.on('displayed', async (sectionResult: any) => {
        console.log(`[EPUB Displayed Event] For section: ${sectionResult?.href}. Target: ${docToInit.id}, Active: ${activeDoc?.id}`);
        if (!isMountedRef.current || epubRenditionRef.current !== rendition || activeDoc?.id !== docToInit.id) { return; }
        
        try {
            const displayedContents = await rendition!.getContents();
            const extractedText = displayedContents?.[0]?.document?.body?.innerText?.replace(/\s+/g, ' ').trim() ?? "";
            console.log(`[EPUB Displayed Event] Extracted text (length: ${extractedText.length}) for doc: ${docToInit.id}`);

            if (isMountedRef.current && activeDoc?.id === docToInit.id) { 
                setCurrentTextForTTS(extractedText || "EPUB section loaded. Text may be graphical or empty.");
                setIsEpubSectionDisplayed(true); 
                setIsEpubLoading(false); setIsLoadingDoc(false);
                console.log(`[EPUB Displayed Event] States for ${docToInit.id} set: isEpubSectionDisplayed: true, isLoading: false.`);
            }
        } catch (textExtractError: any) {
            console.error("[EPUB Displayed Event] Error extracting text:", textExtractError, "for doc:", docToInit.id);
            if (isMountedRef.current && activeDoc?.id === docToInit.id) {
                setCurrentTextForTTS(""); setDocErrorMessage(`Error extracting EPUB text: ${textExtractError.message}`);
                setIsEpubSectionDisplayed(true); setIsEpubLoading(false); setIsLoadingDoc(false);
            }
        }
      });
      
      console.log("[EPUB Init] Attempting rendition.display() for doc:", docToInit.id);
      await rendition.display();
      console.log(`[EPUB Init] rendition.display() completed for doc: ${docToInit.id}.`);

    } catch (e: any) {
      console.error("[EPUB Init] Error during EPUB initialization for doc:", docToInit.id, e);
      if (isMountedRef.current && activeDoc?.id === docToInit.id) {
        setDocErrorMessage(`Failed to load EPUB "${docToInit.title}": ${e.message || String(e)}`);
        setCurrentTextForTTS("");
        setIsEpubLoading(false); setIsLoadingDoc(false);
      }
    }
  }, [activeDoc?.id, activeDoc?.title]);

  useEffect(() => {
    const loadDocumentData = async () => {
      if (!isMountedRef.current) return;
      
      const docIdFromParams = searchParams.get('docId');
      let finalDocIdToLoad = docIdFromParams;

      if (activeDoc?.id === finalDocIdToLoad && !isLoadingDoc) {
        console.log(`[MainEffect] Doc ${finalDocIdToLoad} already active. Skipping reload.`);
        return;
      }
      
      stopSpeech(true); 
      
      if (epubBookRef.current || epubRenditionRef.current) { await cleanupEpubInstances(); }

      if(isMountedRef.current) {
        setActiveDoc(null); setDocErrorMessage(null); setIsLoadingDoc(true); setIsPerformingOcr(false); setCurrentTextForTTS(""); 
        if (pdfDocProxy) { try { pdfDocProxy.destroy(); } catch(e) { console.warn("Error destroying PDF proxy", e); } }
        setPdfDocProxy(null); setCurrentPdfPageNum(1); setPdfTotalPages(0); setPdfPageImage(null); setPdfPageIsTextBased(true);
        if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
        setDisplayedImageSrc(null); setTxtContent("");
        setIsEpubLoading(false); setIsEpubSectionDisplayed(false);
      }

      if (!finalDocIdToLoad) {
        const lastActiveId = await IndexedDBService.getLastActiveDocId();
        if (lastActiveId) {
            finalDocIdToLoad = lastActiveId;
            router.replace(`/reader?docId=${finalDocIdToLoad}`, { scroll: false }); 
            return;
        } else {
          if(isMountedRef.current) {
            setDocErrorMessage("No document selected. Please choose one from the Library.");
            setIsLoadingDoc(false);
          }
          return;
        }
      }
      
      let newActiveDoc: StoredMangaDocument | null = null;
      try {
        newActiveDoc = await IndexedDBService.getDocumentById(finalDocIdToLoad!);
        if (!newActiveDoc) {
          if(isMountedRef.current) {
            setDocErrorMessage(`Document with ID "${finalDocIdToLoad}" not found.`);
            await IndexedDBService.saveLastActiveDocId(null); setIsLoadingDoc(false);
          }
          return;
        }
        
        if (isMountedRef.current) {
            setActiveDoc(newActiveDoc as ActiveMangaDocument); 
            await IndexedDBService.saveLastActiveDocId(finalDocIdToLoad!);

            if (newActiveDoc.type === 'pdf') { setCurrentTextForTTS("Loading PDF...");
            } else if (newActiveDoc.type === 'txt') {
                try {
                    const text = new TextDecoder().decode(newActiveDoc.fileData);
                    setTxtContent(text); setCurrentTextForTTS(text); setIsLoadingDoc(false);
                } catch (e: any) { setDocErrorMessage(`Failed to decode TXT file: ${e.message}`); setIsLoadingDoc(false); }
            } else if (newActiveDoc.type === 'image') {
                try {
                    const blob = new Blob([newActiveDoc.fileData], { type: newActiveDoc.originalType });
                    if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); }
                    const newUrl = URL.createObjectURL(blob);
                    currentImageObjectUrlRef.current = newUrl;
                    setDisplayedImageSrc(newUrl);
                    setCurrentTextForTTS((newActiveDoc as StoredImageDocument).extractedText || "Image loaded. Perform OCR to extract text.");
                    setIsLoadingDoc(false);
                } catch (e: any) { setDocErrorMessage(`Failed to load image: ${e.message}`); setIsLoadingDoc(false); }
            } else if (newActiveDoc.type === 'mobi') {
                setDocErrorMessage("MOBI files are not directly viewable. Please convert to EPUB or PDF.");
                setIsLoadingDoc(false);
            } else if (newActiveDoc.type === 'epub') {
                console.log(`[MainEffect] EPUB doc identified. Setting up for init.`);
                setIsEpubLoading(true); // setIsLoadingDoc is already true
            } else {
                setIsLoadingDoc(false);
            }
        }
      } catch (err: any) {
        if(isMountedRef.current) {
            setDocErrorMessage(`Error loading document: ${err.message}`);
            setIsLoadingDoc(false); setActiveDoc(null);
        }
      }
    };
    loadDocumentData();
  }, [searchParams, router]); // Main loading effect

  useEffect(() => {
    let timerId: NodeJS.Timeout | null = null;
    const currentEpubDoc = activeDoc;

    if (currentEpubDoc?.type === 'epub' && currentEpubDoc.fileData && isMountedRef.current) {
        timerId = setTimeout(() => {
            if (isMountedRef.current && activeDoc?.id === currentEpubDoc.id && activeDoc.type === 'epub') {
                if (epubViewerRef.current) {
                    console.log(`[EPUB Init Effect] Timeout finished. Initializing EPUB for doc: ${currentEpubDoc.id}.`);
                    initializeNewEpub(currentEpubDoc as StoredEpubDocument);
                } else {
                    if (isMountedRef.current && activeDoc?.id === currentEpubDoc.id) {
                        setDocErrorMessage("EPUB viewer element failed to initialize. Please reload.");
                        setIsLoadingDoc(false); setIsEpubLoading(false);
                    }
                }
            }
        }, 100); // Delay to allow DOM to update
    }
    return () => { if (timerId) clearTimeout(timerId); };
  }, [activeDoc, initializeNewEpub]);

  useEffect(() => {
    if (activeDoc?.type === 'pdf' && activeDoc.fileData && !pdfDocProxy && isMountedRef.current) {
        if (!isLoadingDoc && isMountedRef.current) setIsLoadingDoc(true); 
        getDocument({ data: activeDoc.fileData.slice(0) }).promise.then(pdf => {
            if(!isMountedRef.current) { try {pdf.destroy();} catch(e){} return; }
            setPdfDocProxy(pdf); setPdfTotalPages(pdf.numPages);
            const savedPageIndex = LocalStorageService.loadCurrentPdfPageIndexForDoc(activeDoc.id);
            setCurrentPdfPageNum((savedPageIndex > 0 && savedPageIndex <= pdf.numPages) ? savedPageIndex : 1);
        }).catch(e => {
            if(!isMountedRef.current) return;
            setDocErrorMessage(`Failed to load PDF: ${e.message}`); setIsLoadingDoc(false);
        });
    }
  }, [activeDoc, isLoadingDoc]);

  useEffect(() => {
    if (activeDoc?.type !== 'pdf' || !pdfDocProxy || !currentPdfPageNum || !isMountedRef.current) return;

    let isStale = false;
    const renderPage = async () => {
        stopSpeech(true); setIsRenderingPdfPage(true); setPdfPageImage(null); setPdfPageIsTextBased(true); setCurrentTextForTTS(`Loading PDF page ${currentPdfPageNum}...`);
        LocalStorageService.saveCurrentPdfPageIndexForDoc(activeDoc.id, currentPdfPageNum);

        try {
            const page: PDFPageProxy = await pdfDocProxy.getPage(currentPdfPageNum);
            if (isStale) { if (page) page.cleanup(); return; }
            
            const viewport = page.getViewport({ scale: pdfScale });
            const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
            canvas.height = viewport.height; canvas.width = viewport.width;
            
            if (context) await page.render({ canvasContext: context, viewport }).promise;
            if (isStale) { if (page) page.cleanup(); return; }
            if (isMountedRef.current) setPdfPageImage(canvas.toDataURL('image/png'));
            
            const pdfDocFromState = activeDoc as StoredPdfDocument;
            if (pdfDocFromState.ocrTextPerPage?.[currentPdfPageNum]) {
                if (isMountedRef.current) { setCurrentTextForTTS(pdfDocFromState.ocrTextPerPage[currentPdfPageNum]); setPdfPageIsTextBased(false); }
            } else {
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim();
                if (pageText.length >= MIN_PDF_TEXT_LENGTH_FOR_DIRECT_READ) {
                    if (isMountedRef.current) { setCurrentTextForTTS(pageText); setPdfPageIsTextBased(true); }
                } else {
                    if (isMountedRef.current) { setCurrentTextForTTS("This PDF page has no selectable text. Use OCR to extract text."); setPdfPageIsTextBased(false); }
                }
            }
            if (page) page.cleanup();
            if (isMountedRef.current) { setIsLoadingDoc(false); setIsRenderingPdfPage(false); }
        } catch (e: any) {
            if (isStale || !isMountedRef.current) return;
            setDocErrorMessage(`Error rendering PDF page ${currentPdfPageNum}: ${e.message}`);
            setIsLoadingDoc(false); setIsRenderingPdfPage(false);
        }
    };

    renderPage();
    return () => { isStale = true; };
  }, [pdfDocProxy, currentPdfPageNum, pdfScale]);

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
            const newVoices = newRawVoices.map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService, default: v.default }));

            const getSignature = (voices: TTSVoice[]) => voices.map(v => `${v.voiceURI}|${v.name}|${v.lang}`).sort().join(';');
            
            if (getSignature(prevVoices) === getSignature(newVoices)) {
                return prevVoices;
            }
            console.log("[TTS] Voices updated.");
            return newVoices;
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
        const systemVoices = availableVoices.length > 0 ? availableVoices : (typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService, default: v.default })) : []);
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
                    const absoluteFallback = systemVoices.find(v => v.default && v.lang) || systemVoices[0];
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
  }, [ttsSettings.engine, ttsSettings.language, ttsSettings.voiceURI, availableVoices]);


  useEffect(() => {
    const player = new Audio(); audioPlayerRef.current = player;
    const handleAudioEnded = () => { if (audioPlayerRef.current === player && isSpeaking && ttsSettings.engine === 'cloud' && isMountedRef.current) { stopSpeech(true); } };
    const handleAudioPlaying = () => { if (audioPlayerRef.current === player && ttsSettings.engine === 'cloud' && isSpeaking && isMountedRef.current) { setIsLoadingTTS(false); } };
    const handleAudioError = () => { if (audioPlayerRef.current === player && isSpeaking && ttsSettings.engine === 'cloud' && isMountedRef.current) { toast({variant: "destructive", title: "Audio Error", description: "Failed to play cloud TTS audio."}); stopSpeech(true); } };
    player.addEventListener('ended', handleAudioEnded); player.addEventListener('playing', handleAudioPlaying); player.addEventListener('error', handleAudioError);
    return () => {
        player.removeEventListener('ended', handleAudioEnded); player.removeEventListener('playing', handleAudioPlaying); player.removeEventListener('error', handleAudioError);
        if (player.src && !player.paused) player.pause(); player.src = "";
        if (audioPlayerRef.current === player) audioPlayerRef.current = null;
    };
  }, [ttsSettings.engine, isSpeaking, stopSpeech, toast]);


  const playPauseSpeech = async () => {
    if(!isMountedRef.current) return;
    const selection = typeof window !== 'undefined' ? window.getSelection() : null; const selectedTextFromSelection = selection?.toString().trim();
    const effectiveTextToRead = selectedTextFromSelection || currentTextForTTS;
    const invalidMessages = [ "error:", "failed to load", "loading", "mobi files", "image loaded", "no text content", "no selectable text", "ocr completed, no text found", "no document selected", "graphical or empty", "could not load epub", "waiting for page" ];
    if (!effectiveTextToRead || invalidMessages.some(msg => effectiveTextToRead.toLowerCase().includes(msg)) || effectiveTextToRead.length < MIN_TTS_TEXT_LENGTH) { toast({ variant: "destructive", title: "No Valid Text", description: `No valid text to read (min ${MIN_TTS_TEXT_LENGTH} chars). Text was: "${effectiveTextToRead.substring(0,50)}..."` }); return; }
    if (isSpeaking) {
      if (isPaused) {
        if (ttsSettings.engine === 'local' && utteranceRef.current && window.speechSynthesis?.paused) { window.speechSynthesis.resume(); if(isMountedRef.current) setIsPaused(false);
        } else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current?.paused) { audioPlayerRef.current.play().then(() => {if(isMountedRef.current) setIsPaused(false);}).catch(() => {if(isMountedRef.current) stopSpeech(true);}); }
      } else {
        if (ttsSettings.engine === 'local' && utteranceRef.current && window.speechSynthesis?.speaking) { window.speechSynthesis.pause(); if(isMountedRef.current) setIsPaused(true);
        } else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current && !audioPlayerRef.current.paused) { audioPlayerRef.current.pause(); if(isMountedRef.current) setIsPaused(true); }
      }
    } else {
      stopSpeech(false); if(isMountedRef.current) { setIsLoadingTTS(true); setIsSpeaking(true); setIsPaused(false); }
      if (ttsSettings.engine === 'local') {
        if (typeof window === 'undefined' || !window.speechSynthesis) { toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." }); stopSpeech(true); return; }
        const utterance = new SpeechSynthesisUtterance(effectiveTextToRead); utterance.lang = ttsSettings.language; utterance.pitch = ttsSettings.pitch; utterance.rate = ttsSettings.rate;
        const systemVoices = window.speechSynthesis.getVoices(); let voiceToUse: SpeechSynthesisVoice | undefined = systemVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
        if (voiceToUse) utterance.voice = voiceToUse;
        utterance.onend = () => { if(utteranceRef.current === utterance && isMountedRef.current) stopSpeech(true); };
        utterance.onerror = (event) => { if(utteranceRef.current === utterance && isMountedRef.current) { toast({ variant: "destructive", title: "TTS Error", description: event.error || "Speech failed." }); stopSpeech(true); }};
        utteranceRef.current = utterance; window.speechSynthesis.speak(utterance); if(isMountedRef.current) setIsLoadingTTS(false); 
      } else { 
        try {
          const result = await getCloudSpeech(effectiveTextToRead, ttsSettings.language);
          if(!isMountedRef.current) return; 
          if ('audioUrl' in result && audioPlayerRef.current) { audioPlayerRef.current.src = result.audioUrl; await audioPlayerRef.current.play(); } 
          else if ('error' in result) { toast({ variant: "destructive", title: "Cloud TTS Error", description: result.error }); if(isMountedRef.current) stopSpeech(true); }
        } catch (e: any) { if(isMountedRef.current) { toast({ variant: "destructive", title: "Cloud TTS Failed", description: e.message }); stopSpeech(true); } }
      }
    }
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
    if(!isMountedRef.current || !activeDoc) return;
    const selectionFromWindow = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const textToFavorite = selectionFromWindow || currentTextForTTS;
    const invalidMessages = [ "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading EPUB content...", "Preparing EPUB reader...", "Loading text file...", "Loading image...", "Image loaded. Perform OCR", "No text content found", "Could not extract text", "EPUB viewer element not ready", "This PDF page has no selectable text", "Performing OCR...", "No document ID provided", "Document with ID", "EPUB viewer became unavailable.", "OCR completed, no text found.", "No document selected.", "EPUB section loaded. Text may be graphical or empty.", "Could not load EPUB section content.", "EPUB viewer element failed to initialize.", "EPUB content could not be displayed."];
    if (textToFavorite && !invalidMessages.some(msg => textToFavorite.toLowerCase().startsWith(msg.toLowerCase())) && textToFavorite.length >= MIN_TTS_TEXT_LENGTH) {
      LocalStorageService.addFavoriteItem({ id: Date.now().toString(), text: textToFavorite, sourceDocumentId: activeDoc.id, sourceDocumentName: activeDoc.title, createdAt: Date.now() });
      toast({ title: "Favorited!", description: `"${textToFavorite.substring(0,50)}..." added.`});
    } else { toast({ variant: "destructive", title: "No Valid Text to Favorite", description: `Ensure valid text (min ${MIN_TTS_TEXT_LENGTH} chars) is available or selected.` }); }
  };

  const navigatePdf = (direction: 'prev' | 'next') => {
    if (!pdfDocProxy || isRenderingPdfPage || isLoadingDoc || !isMountedRef.current) return;
    let newPage = currentPdfPageNum;
    if (direction === 'prev' && currentPdfPageNum > 1) newPage--;
    else if (direction === 'next' && currentPdfPageNum < pdfTotalPages) newPage++;
    else return; 
    if (newPage !== currentPdfPageNum) { stopSpeech(true); if(isMountedRef.current) setCurrentPdfPageNum(newPage); }
  };
  const handlePdfScaleChange = (newScale: number) => { if (isRenderingPdfPage || !isMountedRef.current || isLoadingDoc) return; stopSpeech(true); if(isMountedRef.current) setPdfScale(newScale); };

  const navigateEpub = async (direction: 'prev' | 'next') => {
    if (!isMountedRef.current || !epubRenditionRef.current || !isEpubSectionDisplayed) { toast({ variant: "default", title: "EPUB State", description: "EPUB reader is not ready for navigation."}); return; }
    if (!epubRenditionRef.current.manager?.active) { toast({ variant: "default", title: "EPUB State", description: "EPUB rendition manager is not active."}); return; }
    stopSpeech(true);
    try {
      if (direction === 'prev') { await epubRenditionRef.current.prev(); } else { await epubRenditionRef.current.next(); }
    } catch (error) { console.error(`[EPUB Nav] Error during rendition.${direction}():`, error); toast({ variant: "destructive", title: "EPUB Navigation Error", description: `Failed to turn page.` }); }
  };

  const getButtonState = () => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : ''; const effectiveText = selectedText || currentTextForTTS;
    const invalidMessages = [ "error:", "failed to load", "loading", "mobi files", "image loaded", "no text content", "no selectable text", "ocr completed, no text found", "no document selected", "graphical or empty", "could not load epub", "waiting for page" ];
    let canPlay = !!(effectiveText && !invalidMessages.some(msg => effectiveText.toLowerCase().includes(msg)) && effectiveText.length >= MIN_TTS_TEXT_LENGTH && activeDoc && !isPerformingOcr && !docErrorMessage );
    
    if (activeDoc?.type === 'pdf' && (isLoadingDoc || isRenderingPdfPage)) canPlay = false;
    else if (activeDoc?.type === 'epub' && (isLoadingDoc || isEpubLoading || !isEpubSectionDisplayed)) canPlay = false;
    else if (activeDoc?.type === 'image' && isLoadingDoc) canPlay = false; 
    else if (activeDoc?.type === 'txt' && isLoadingDoc) canPlay = false;
    else if (!activeDoc) canPlay = false;

    if (isLoadingTTS) return { text: "Loading...", icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, disabled: true };
    if (isSpeaking && !isPaused) return { text: "Pause", icon: <Pause className="mr-1 h-4 w-4" />, disabled: false };
    if (isSpeaking && isPaused) return { text: "Resume", icon: <Play className="mr-1 h-4 w-4" />, disabled: false };
    return { text: selectedText ? "Play Selected" : "Play Text", icon: <Play className="mr-1 h-4 w-4" />, disabled: !canPlay };
  };
  const buttonState = getButtonState();

  if (isLoadingDoc && !activeDoc && !docErrorMessage) { 
    return <div className="flex items-center justify-center h-full flex-grow"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-lg">Loading document...</p></div>; 
  }
  if (docErrorMessage && !activeDoc) { 
    return <div className="flex flex-col items-center justify-center h-full flex-grow p-4 text-center"> <AlertTriangle className="h-12 w-12 text-destructive mb-4" /> <h2 className="text-xl font-semibold mb-2">Error Loading Document</h2> <p className="text-muted-foreground mb-4">{docErrorMessage}</p> <Button onClick={() => router.push('/library')}>Go to Library</Button> </div>; 
  }

  const showOcrButtonForPdfPage = activeDoc?.type === 'pdf' && !pdfPageIsTextBased && pdfPageImage && !isRenderingPdfPage && !isLoadingDoc && !isPerformingOcr;
  const showOcrButtonForImage = activeDoc?.type === 'image' && displayedImageSrc && !isLoadingDoc && !isPerformingOcr && !(activeDoc as StoredImageDocument).extractedText;

  return (
    <div className="flex flex-col lg:flex-row w-full h-[calc(100vh-4rem)]"> 
      <div className="flex-grow overflow-y-auto bg-muted/20 p-2 md:p-4 relative">
         {docErrorMessage && activeDoc && (
            <div className="absolute inset-x-0 top-4 mx-auto w-fit max-w-md bg-destructive/10 border border-destructive text-destructive p-3 rounded-md shadow-lg z-10 flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div> <p className="font-medium text-sm">Document Display Issue</p> <p className="text-xs">{docErrorMessage}</p> <Button variant="ghost" size="sm" className="text-xs h-auto p-1 mt-1 text-destructive hover:bg-destructive/20" onClick={() => {if(isMountedRef.current) setDocErrorMessage(null);}}>Dismiss</Button> </div>
            </div>
        )}
        
        {isLoadingDoc && activeDoc && (activeDoc.type === 'image' || activeDoc.type === 'txt') && <div className="flex items-center justify-center h-full"> <Loader2 className="h-10 w-10 animate-spin text-primary" /><p className="ml-3">Loading content...</p> </div> }
        {activeDoc?.type === 'epub' && (isLoadingDoc || isEpubLoading) && !isEpubSectionDisplayed && <div className="flex items-center justify-center h-full"> <Loader2 className="h-10 w-10 animate-spin text-primary" /><p className="ml-3">Loading EPUB...</p> </div> }

        {!isLoadingDoc && activeDoc?.type === 'pdf' && (
          <div className="flex flex-col items-center">
            {isRenderingPdfPage && !pdfPageImage && <Loader2 className="h-10 w-10 animate-spin my-8 text-primary" />}
            {pdfPageImage && <NextImage src={pdfPageImage} alt={`Page ${currentPdfPageNum}`} width={0} height={0} sizes="100vw" style={{ width: 'auto', height: 'auto', maxHeight: 'calc(100vh - 12rem)', maxWidth: '100%', objectFit: 'contain' }} className="shadow-lg border rounded-md" />}
            {showOcrButtonForPdfPage && (<Button onClick={handlePerformOcr} disabled={isPerformingOcr} className="mt-3"> {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR on PDF Page </Button> )}
          </div>
        )}
        
        <div
            key={activeDoc?.id || 'no-epub-doc'} 
            ref={epubViewerRef} 
            id="epub-viewer"
            className={cn(
                "w-full h-full epub-viewer-container bg-background rounded-md shadow-inner",
                (activeDoc?.type !== 'epub' || !isEpubSectionDisplayed) && "hidden"
            )} 
        />

        {!isLoadingDoc && activeDoc?.type === 'txt' && ( <pre className="whitespace-pre-wrap p-4 bg-background rounded-md shadow-inner text-sm font-mono h-full overflow-y-auto select-text">{txtContent}</pre> )}
        {!isLoadingDoc && activeDoc?.type === 'image' && displayedImageSrc && (
            <div className="flex flex-col items-center">
                <NextImage src={displayedImageSrc} alt={activeDoc.title || 'Uploaded Image'} width={800} height={600} style={{objectFit: 'contain'}} className="max-w-full max-h-[calc(100vh-15rem)] shadow-lg border rounded-md" data-ai-hint="illustration abstract" />
                {showOcrButtonForImage && <Button onClick={handlePerformOcr} disabled={isPerformingOcr} className="mt-3"> {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR on Image </Button> }
            </div>
        )}
        {!isLoadingDoc && activeDoc?.type === 'mobi' && ( <div className="p-4 bg-background rounded-md shadow-inner text-center h-full flex flex-col justify-center items-center"> <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2"/> <p className="font-semibold">MOBI Not Supported</p> <p className="text-sm text-muted-foreground">Please convert to EPUB or PDF.</p> </div> )}
        
        { activeDoc && !isLoadingDoc && !isRenderingPdfPage && !isPerformingOcr && !isEpubLoading && currentTextForTTS && ((activeDoc.type === 'epub' && isEpubSectionDisplayed) || (activeDoc.type !== 'epub')) &&
            <Card className="mt-4 sticky bottom-2 bg-background/90 backdrop-blur-sm shadow-md">
                <CardHeader className="pb-1 pt-3"> <CardTitle className="text-sm flex items-center"><FileText className="mr-2 h-4 w-4"/> Current Text for TTS</CardTitle> </CardHeader>
                <CardContent className="pt-0"> <textarea readOnly value={currentTextForTTS} className="w-full h-20 p-2 border rounded-md bg-muted/30 text-xs select-text" placeholder="Text for TTS..." /> </CardContent>
            </Card>
        }
      </div>

      <div className="w-full lg:w-80 xl:w-96 p-3 border-l bg-background flex-shrink-0 overflow-y-auto space-y-4">
        <Card>
            <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-base truncate flex items-center gap-1"> <BookOpen className="h-5 w-5 text-primary"/> {activeDoc?.title || "No Document Loaded"} </CardTitle>
                <CardDescription className="text-xs">Type: {activeDoc?.type.toUpperCase()}{activeDoc?.type === 'pdf' && pdfTotalPages > 0 ? `, Page: ${currentPdfPageNum}/${pdfTotalPages}` : ''}</CardDescription>
            </CardHeader>
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
                <Button onClick={() => navigateEpub('prev')} size="sm" variant="outline" disabled={!isEpubSectionDisplayed}> <ChevronLeft /> Previous </Button>
                <Button onClick={() => navigateEpub('next')} size="sm" variant="outline" disabled={!isEpubSectionDisplayed}> Next <ChevronRight /> </Button>
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
            <Button onClick={playPauseSpeech} disabled={buttonState.disabled} variant={isSpeaking && !isPaused ? "outline" : "default"} className="w-full h-9 text-sm">{buttonState.icon} {buttonState.text}</Button>
            <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="w-full mt-2 text-xs" disabled={!activeDoc}> <Star className="mr-2 h-3 w-3" /> Favorite Text/Selection </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
