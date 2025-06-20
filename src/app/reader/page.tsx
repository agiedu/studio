
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
import type { TTSSettings, TTSVoice, StoredMangaDocument, ActiveMangaDocument, StoredPdfDocument, StoredImageDocument, StoredEpubDocument, StoredTxtDocument } from '@/types';
import { cn } from '@/lib/utils';

const PDF_DEFAULT_SCALE = 1.5;
const MIN_PDF_TEXT_LENGTH_FOR_DIRECT_READ = 20;
const MIN_TTS_TEXT_LENGTH = 5;

type EpubBook = import('epubjs').Book;
type Rendition = import('epubjs').Rendition;
type Section = import('epubjs/types/section').default;


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
  const epubViewerRef = useRef<HTMLDivElement | null>(null);
  const [isEpubLoading, setIsEpubLoading] = useState(false);
  const [isEpubSectionDisplayed, setIsEpubSectionDisplayed] = useState(false);
  const [epubGoToSectionInput, setEpubGoToSectionInput] = useState<string>("");
  const isMountedRef = useRef(false);

  const [txtContent, setTxtContent] = useState<string>("");
  const [displayedImageSrc, setDisplayedImageSrc] = useState<string | null>(null);
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

  const cleanupEpubInstances = useCallback(() => {
    console.log("[EPUB Cleanup] Initiating cleanup of EPUB instances.");

    const renditionToDestroy = epubRenditionRef.current;
    if (epubRenditionRef.current) epubRenditionRef.current = null; // Nullify React ref immediately

    if (renditionToDestroy) {
        console.log("[EPUB Cleanup] Scheduling rendition.destroy() via requestAnimationFrame.");
        requestAnimationFrame(() => { // Defer to avoid issues if epubjs is mid-operation
            try {
                if (isMountedRef.current) { // Double check mount status inside rAF
                    // Check if the ref was reassigned (e.g. new book loaded quickly)
                    // Only destroy if this is still the 'original' instance intended for cleanup
                    // This check is subtle: if epubRenditionRef.current is now non-null, it means a new one loaded.
                    // If it's null, it means we nulled it and this is the one.
                    // So, we operate on renditionToDestroy, which holds the instance at time of cleanup call.
                    console.log("[EPUB Cleanup/rAF] Destroying rendition instance that was current at cleanup call.");
                    renditionToDestroy.destroy();
                } else {
                    console.log("[EPUB Cleanup/rAF] Component unmounted before rendition.destroy() could be called.");
                }
            } catch (e: any) {
                console.warn("[EPUB Cleanup/rAF] Error destroying EPUB rendition via rAF:", e.message || e);
            }
        });
    } else {
        console.log("[EPUB Cleanup] No active rendition instance to destroy (epubRenditionRef.current was already null or never set).");
    }

    const bookToDestroy = epubBookRef.current;
    if (epubBookRef.current) epubBookRef.current = null; // Nullify React ref immediately

    if (bookToDestroy) {
        console.log("[EPUB Cleanup] Destroying EPUB book instance.");
        try {
            bookToDestroy.destroy();
        } catch (e: any) {
            console.warn("[EPUB Cleanup] Error destroying EPUB book instance:", e.message || e);
        }
    } else {
        console.log("[EPUB Cleanup] No active book instance to destroy (epubBookRef.current was already null or never set).");
    }
    
    if (isMountedRef.current) {
        setIsEpubSectionDisplayed(false);
        setEpubGoToSectionInput("");
    }
    console.log("[EPUB Cleanup] Completed cleanupEpubInstances.");
  }, []);


  // General document metadata loading effect
  useEffect(() => {
    console.log("[ReaderPage] Main metadata load effect: Initiating.");
    stopSpeech(true);

    // PDF specific cleanup
    if (pdfDocProxy) { try { pdfDocProxy.destroy(); } catch(e) { console.warn("Error destroying PDF proxy on doc change", e);}}
    if (isMountedRef.current) {
      setPdfDocProxy(null); setCurrentPdfPageNum(1); setPdfTotalPages(0); setPdfPageImage(null); setPdfPageIsTextBased(true); setIsRenderingPdfPage(false);
    }
    // Image specific cleanup
    if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
    if (isMountedRef.current) {
        setDisplayedImageSrc(null);
    }
    // TXT specific cleanup
    if (isMountedRef.current) {
        setTxtContent("");
    }
    // General UI reset
    if (isMountedRef.current) {
        setCurrentTextForTTS("");
        setDocErrorMessage(null);
        setIsLoadingDoc(true); 
        setIsPerformingOcr(false);
    }
    
    // Call cleanup for any existing EPUB before loading new doc metadata
    // This is important if switching from an EPUB to another doc type, or EPUB to EPUB.
    if (epubBookRef.current || epubRenditionRef.current) { // Check if there are EPUB refs to clean
        console.log("[ReaderPage] Main metadata load effect: Previous EPUB refs exist. Calling cleanupEpubInstances before loading new doc.");
        cleanupEpubInstances();
    }
     if (isMountedRef.current) { // Reset EPUB specific loading flags as well
        setIsEpubLoading(false); 
        setIsEpubSectionDisplayed(false);
     }


    const loadDocumentMetadata = async () => {
      let docIdToLoad = searchParams.get('docId');
      if (!docIdToLoad) {
        const lastActiveId = await IndexedDBService.getLastActiveDocId();
        if (lastActiveId) docIdToLoad = lastActiveId;
        else {
          if(isMountedRef.current) { setDocErrorMessage("No document selected. Please choose one from the Library."); setIsLoadingDoc(false); setActiveDoc(null); }
          return;
        }
      }
       if (!docIdToLoad && isMountedRef.current) { 
         setDocErrorMessage("No document selected and no previously active document found."); setIsLoadingDoc(false); setActiveDoc(null);
         return;
      }

      try {
        console.log(`[ReaderPage] Loading document metadata for ID: ${docIdToLoad}`);
        const doc = await IndexedDBService.getDocumentById(docIdToLoad!); 
        if (!doc) {
          if(isMountedRef.current) { setDocErrorMessage(`Document with ID "${docIdToLoad}" not found.`); await IndexedDBService.saveLastActiveDocId(null); setIsLoadingDoc(false); setActiveDoc(null); }
          return;
        }
        if(isMountedRef.current) { setActiveDoc(doc as ActiveMangaDocument); } 
        await IndexedDBService.saveLastActiveDocId(docIdToLoad!);
      } catch (err: any) {
        if(isMountedRef.current) { setDocErrorMessage(`Error loading document metadata: ${err.message}`); setIsLoadingDoc(false); setActiveDoc(null); }
      }
    };
    loadDocumentMetadata();

    return () => {
      console.log("[ReaderPage] Main metadata load useEffect UNMOUNT/CLEANUP]: General speech stop. Specific resource cleanup in other effects.");
      stopSpeech(true);
      if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
      if (pdfDocProxy) { try { pdfDocProxy.destroy(); } catch(e) { console.warn("Error destroying PDF proxy on main unmount", e);}}
      // EPUB cleanup is primarily handled by its dedicated effect's return function.
      console.log("[ReaderPage] Main metadata load useEffect UNMOUNT/CLEANUP]: Calling cleanupEpubInstances.");
      cleanupEpubInstances();
    };
  }, [searchParams, stopSpeech, cleanupEpubInstances]); // Added cleanupEpubInstances to dependency array


  // PDF Loading Effect
  useEffect(() => {
    if (activeDoc?.type === 'pdf' && activeDoc.fileData && isMountedRef.current) {
      console.log("[PDF Effect] Loading PDF document:", activeDoc.id);
      setCurrentTextForTTS("Loading PDF..."); setDocErrorMessage(null);
      if (pdfDocProxy) { 
        try { pdfDocProxy.destroy(); } catch(e){console.warn("Error destroying previous pdfDocProxy", e);}
        setPdfDocProxy(null);
      }

      getDocument({ data: activeDoc.fileData.slice(0) }).promise.then(pdf => {
        if(!isMountedRef.current || activeDoc?.type !== 'pdf') { 
             try {pdf.destroy();} catch(e){}
             console.log("[PDF Effect] PDF load no longer relevant (unmounted or doc changed).");
             return;
        }
        console.log("[PDF Effect] PDF loaded successfully:", activeDoc.id);
        setPdfDocProxy(pdf); setPdfTotalPages(pdf.numPages);
        const savedPageIndex = LocalStorageService.loadCurrentPdfPageIndexForDoc(activeDoc.id);
        const pageToLoad = (savedPageIndex && savedPageIndex > 0 && savedPageIndex <= pdf.numPages) ? savedPageIndex : 1;
        setCurrentPdfPageNum(pageToLoad);
        // setIsLoadingDoc(false) will be handled by page render effect
      }).catch(e => {
        if(!isMountedRef.current) return;
        console.error("[PDF Effect] Failed to load PDF:", activeDoc.id, e);
        setDocErrorMessage(`Failed to load PDF: ${e.message}`); setCurrentTextForTTS(""); setIsLoadingDoc(false);
      });
    }
     return () => { // Cleanup specific to PDF when activeDoc changes from PDF or unmounts
        if (activeDoc?.type === 'pdf' && pdfDocProxy && !isMountedRef.current) { // If component unmounted with PDF active
             console.log("[PDF Effect Cleanup] Component unmounted, destroying active PDF proxy for doc:", activeDoc.id);
             try { pdfDocProxy.destroy(); } catch(e) { console.warn("Error destroying PDF proxy on PDF effect unmount", e); }
        }
    };
  }, [activeDoc]);

  // PDF Page Rendering Effect
  useEffect(() => {
    if (activeDoc?.type === 'pdf' && pdfDocProxy && currentPdfPageNum > 0 && currentPdfPageNum <= pdfTotalPages && isMountedRef.current) {
      console.log(`[PDF Page Effect] Rendering PDF page ${currentPdfPageNum} for doc:`, activeDoc.id);
      stopSpeech(true); setIsRenderingPdfPage(true); setPdfPageImage(null); setPdfPageIsTextBased(true); setCurrentTextForTTS(`Loading PDF page ${currentPdfPageNum}...`);
      LocalStorageService.saveCurrentPdfPageIndexForDoc(activeDoc.id, currentPdfPageNum);

      pdfDocProxy.getPage(currentPdfPageNum).then(async (page: PDFPageProxy) => {
        if(!isMountedRef.current || activeDoc?.type !== 'pdf' || !pdfDocProxy || pdfDocProxy.fingerprint !== page.pdfManager.docId) {
            console.log(`[PDF Page Effect] PDF page render no longer relevant for page ${currentPdfPageNum}.`);
            if (page && typeof page.cleanup === 'function') page.cleanup();
            return;
        }
        console.log(`[PDF Page Effect] Got page ${currentPdfPageNum}. Rendering...`);
        const viewport = page.getViewport({ scale: pdfScale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height; canvas.width = viewport.width;

        if (context) {
          await page.render({ canvasContext: context, viewport }).promise;
          if(isMountedRef.current && activeDoc?.type==='pdf' && pdfDocProxy?.fingerprint === page.pdfManager.docId) setPdfPageImage(canvas.toDataURL('image/png'));
        } else {
          if(isMountedRef.current) {
            setDocErrorMessage("Could not get canvas context for PDF rendering."); setCurrentTextForTTS("");
          } else { if (page && typeof page.cleanup === 'function') page.cleanup(); return; }
        }

        const pdfDocFromState = activeDoc as StoredPdfDocument;
        if (pdfDocFromState.ocrTextPerPage?.[currentPdfPageNum]) {
            if(isMountedRef.current) { setCurrentTextForTTS(pdfDocFromState.ocrTextPerPage[currentPdfPageNum]); setPdfPageIsTextBased(false); }
        } else {
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim();
            if (pageText && pageText.length >= MIN_PDF_TEXT_LENGTH_FOR_DIRECT_READ) {
                if(isMountedRef.current) { setCurrentTextForTTS(pageText); setPdfPageIsTextBased(true); }
            } else {
                if(isMountedRef.current) { setCurrentTextForTTS("This PDF page has no selectable text or is image-based. Use OCR to extract text for reading."); setPdfPageIsTextBased(false); }
            }
        }
        if (page && typeof page.cleanup === 'function') page.cleanup();
        if(isMountedRef.current) setIsLoadingDoc(false); 
      }).catch(e => {
        if(!isMountedRef.current) return;
        console.error(`[PDF Page Effect] Error rendering PDF page ${currentPdfPageNum}:`, e);
        setPdfPageImage(null); setCurrentTextForTTS(""); setDocErrorMessage(`Error rendering PDF page ${currentPdfPageNum}: ${e.message}`); setPdfPageIsTextBased(false); setIsLoadingDoc(false);
      }).finally(() => {
        if(isMountedRef.current) setIsRenderingPdfPage(false);
      });
    }
  }, [activeDoc, pdfDocProxy, currentPdfPageNum, pdfScale, pdfTotalPages, stopSpeech]);


  // TXT File Loading Effect
  useEffect(() => {
    if (activeDoc?.type === 'txt' && activeDoc.fileData && isMountedRef.current) {
        console.log("[TXT Effect] Loading TXT document:", activeDoc.id);
        setCurrentTextForTTS("Loading text file..."); setDocErrorMessage(null);
        try {
            const decoder = new TextDecoder();
            const text = decoder.decode(activeDoc.fileData);
            if(isMountedRef.current) { setTxtContent(text); setCurrentTextForTTS(text); }
        } catch (e: any) {
            if(isMountedRef.current) { setDocErrorMessage(`Failed to decode TXT file: ${e.message}`); setCurrentTextForTTS(""); }
        } finally {
            if(isMountedRef.current) setIsLoadingDoc(false);
        }
    }
  }, [activeDoc]);

  // Image File Loading Effect
  useEffect(() => {
    if (activeDoc?.type === 'image' && activeDoc.fileData && isMountedRef.current) {
        console.log("[Image Effect] Loading Image document:", activeDoc.id);
        setCurrentTextForTTS("Loading image..."); setDocErrorMessage(null);
        try {
            const blob = new Blob([activeDoc.fileData], { type: activeDoc.originalType });
            if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); }
            const newUrl = URL.createObjectURL(blob);
            currentImageObjectUrlRef.current = newUrl;
            if(isMountedRef.current) setDisplayedImageSrc(newUrl);

            const imageDoc = activeDoc as StoredImageDocument;
            if (imageDoc.extractedText) {
                if(isMountedRef.current) setCurrentTextForTTS(imageDoc.extractedText);
            } else {
                if(isMountedRef.current) setCurrentTextForTTS("Image loaded. Perform OCR to extract text for reading aloud.");
            }
        } catch (e: any) {
            if(isMountedRef.current) { setDocErrorMessage(`Failed to load image: ${e.message}`); setCurrentTextForTTS(""); }
        } finally {
            if(isMountedRef.current) setIsLoadingDoc(false);
        }
    }
      return () => { // Cleanup for image object URL
        if (activeDoc?.type === 'image' && currentImageObjectUrlRef.current && !isMountedRef.current) {
            console.log("[Image Effect Cleanup] Component unmounted, revoking image object URL for doc:", activeDoc.id);
            URL.revokeObjectURL(currentImageObjectUrlRef.current);
            currentImageObjectUrlRef.current = null;
        }
    };
  }, [activeDoc]);

  // EPUB Loading and Lifecycle Effect
  useEffect(() => {
    let isEffectActive = true; // Flag to track if the effect is still active

    const initializeNewEpub = async () => {
        if (!isEffectActive || !activeDoc || activeDoc.type !== 'epub' || !activeDoc.fileData) {
            console.warn("[EPUB Init] Aborted: Effect no longer active, or not an EPUB, or no file data.");
            if (isEffectActive) { // Only update state if effect itself is active
                setIsLoadingDoc(false);
                setIsEpubLoading(false);
            }
            return;
        }

        console.log("[EPUB Init] Phase: Starting for doc:", activeDoc.id);
        if (!epubViewerRef.current) {
            console.warn("[EPUB Init] Aborted: epubViewerRef.current is null.");
             if (isEffectActive) { setIsLoadingDoc(false); setIsEpubLoading(false); }
            return;
        }
        
        // Explicitly clear viewer for the new book
        epubViewerRef.current.innerHTML = ''; 

        if (isEffectActive) {
            setIsEpubLoading(true);
            setIsEpubSectionDisplayed(false);
            setCurrentTextForTTS("Loading EPUB...");
            setDocErrorMessage(null);
        }

        try {
            console.log("[EPUB Init] Phase: Importing epubjs for doc:", activeDoc.id);
            const ePubModule = await import('epubjs');
            const EPub = ePubModule.default;

            const book = EPub(activeDoc.fileData);
            if (!isEffectActive) { try { book.destroy(); } catch (e) {} return; }
            epubBookRef.current = book; // Assign to ref

            console.log("[EPUB Init] Phase: book.ready for doc:", activeDoc.id);
            await book.ready;
            if (!isEffectActive || epubBookRef.current !== book) { // Check if ref changed
                 console.warn("[EPUB Init] Stale book instance after ready, or ref changed. Aborting."); try { book.destroy(); } catch(e){} return;
            }
            console.log("[EPUB Init] Phase: Book ready. Doc:", activeDoc.id);

            if (!epubViewerRef.current || !document.body.contains(epubViewerRef.current)) {
                 console.warn("[EPUB Init] Viewer detached before rendering. Aborting.");
                 if(isEffectActive) { setDocErrorMessage("EPUB viewer unavailable."); setIsEpubLoading(false); setIsLoadingDoc(false); }
                 return;
            }

            const rendition = book.renderTo(epubViewerRef.current, { width: "100%", height: "100%", flow: "paginated", spread: "auto" });
            if (!isEffectActive) { try { rendition.destroy(); } catch (e) {} return; }
            epubRenditionRef.current = rendition; // Assign to ref
            console.log("[EPUB Init] Phase: Rendition created. Doc:", activeDoc.id);

            rendition.on('displayed', async (sectionResult: any) => {
                if (!isEffectActive || epubRenditionRef.current !== rendition || !activeDoc || activeDoc.type !== 'epub') {
                    console.log("[EPUB Displayed Event] Conditions not met post-display or stale. Aborting text extraction."); return;
                }
                console.log("[EPUB Displayed Event] Section displayed. Manager Active:", epubRenditionRef.current?.manager?.active, "Manager:", epubRenditionRef.current?.manager);
                
                try {
                    const currentSection: Section | undefined = rendition.currentLocation()?.start?.displayed?.section || (sectionResult as Section) || (sectionResult?.section as Section);
                    let extractedText = "";
                    if (currentSection?.contents) {
                        const displayedContentsElement = currentSection.contents as HTMLElement; // Assume it's an HTMLElement
                        if (displayedContentsElement?.innerText) { // Check for innerText property
                           extractedText = displayedContentsElement.innerText.replace(/\s+/g, ' ').trim();
                        }
                    }
                    if (isEffectActive) {
                        setCurrentTextForTTS(extractedText && extractedText.length >= MIN_TTS_TEXT_LENGTH ? extractedText : "EPUB section loaded. Text may be graphical or empty.");
                        setIsEpubSectionDisplayed(true);
                        console.log("[EPUB Displayed Event] isEpubSectionDisplayed set to true.");
                    }
                } catch (textExtractError: any) {
                    console.error("[EPUB Displayed Event] Error extracting text:", textExtractError);
                    if (isEffectActive) { setCurrentTextForTTS(""); setDocErrorMessage(`Error extracting EPUB text: ${textExtractError.message}`); setIsEpubSectionDisplayed(true); }
                }
            });
            rendition.on('removed', (section: Section) => { console.log('[EPUB Removed Event] Section removed:', section?.id, 'for doc:', activeDoc?.id); });
            rendition.on('resized', (size: {width: number, height: number}) => { console.log('[EPUB Resized Event] New size:', size, 'for doc:', activeDoc?.id); });
            rendition.on('orientationchange', (orientation: string) => { console.log('[EPUB Orientation Change Event] New orientation:', orientation, 'for doc:', activeDoc?.id); });

            console.log("[EPUB Init] Phase: rendition.display() for doc:", activeDoc.id);
            await rendition.display(); // Display the first section or last known location
            if (!isEffectActive || epubRenditionRef.current !== rendition) { // Check if ref changed
                console.warn("[EPUB Init] Stale rendition instance after display, or ref changed. Aborting."); return;
            }
            console.log(`[EPUB Init] Phase: rendition.display() completed. Manager Active: ${rendition.manager?.active}. For doc: ${activeDoc.id}`);

        } catch (e: any) {
            console.error("[EPUB Init] Error during EPUB initialization for doc:", activeDoc?.id, e);
            if (isEffectActive) {
                setDocErrorMessage(`Failed to load EPUB: ${e.message || String(e)}`);
                setCurrentTextForTTS("");
            }
        } finally {
            if (isEffectActive) {
                setIsEpubLoading(false);
                setIsLoadingDoc(false); // General loading for this doc is done.
                console.log("[EPUB Init] Finally block: isEpubLoading and isLoadingDoc set to false. For doc:", activeDoc?.id);
            }
        }
    };

    if (activeDoc?.type === 'epub') {
        console.log(`[EPUB Main Effect] activeDoc is EPUB (${activeDoc.id}). Cleaning up previous and initializing new.`);
        // Cleanup is called by the main metadata effect's return or before loading new doc.
        // Or here, if we want to be absolutely sure before init.
        if (epubBookRef.current || epubRenditionRef.current) {
             console.log("[EPUB Main Effect] Previous EPUB refs exist before initializing new EPUB. Calling cleanupEpubInstances.");
             cleanupEpubInstances();
        }
        initializeNewEpub();
    } else if (activeDoc && activeDoc.type !== 'epub') { // If switching to a non-EPUB doc
        console.log("[EPUB Main Effect] activeDoc is NOT EPUB. Ensuring cleanup of any existing EPUB instances.");
        cleanupEpubInstances();
        if (isEffectActive) { // Reset EPUB specific loading flags
            setIsEpubLoading(false);
            setIsEpubSectionDisplayed(false);
            // setIsLoadingDoc will be handled by the specific loader for the new doc type, or if no doc, by main metadata loader
        }
    }
    // If activeDoc is null, the main metadata effect's cleanup handles epub cleanup.

    return () => {
        isEffectActive = false; // Mark effect as inactive
        console.log("[EPUB Main Effect] Cleanup: Unmounting or activeDoc changed. Calling cleanupEpubInstances for potential EPUB:", activeDoc?.id);
        cleanupEpubInstances();
    };
  }, [activeDoc, cleanupEpubInstances]);


  const handlePerformOcr = useCallback(async () => {
    if (!activeDoc) { toast({ variant: "destructive", title: "OCR Error", description: "No active document." }); return; }
    if (!isMountedRef.current) return;
    stopSpeech(true);
    let dataUrlToProcess: string | null = null;
    const currentActiveDoc = activeDoc;

    if (currentActiveDoc.type === 'pdf' && pdfPageImage && !pdfPageIsTextBased) {
      dataUrlToProcess = pdfPageImage;
    } else if (currentActiveDoc.type === 'image' && currentActiveDoc.fileData) {
        if(isMountedRef.current) setIsPerformingOcr(true);
        try {
            const docToProcess = await IndexedDBService.getDocumentById(currentActiveDoc.id) as StoredImageDocument | null;
            if (!docToProcess || !docToProcess.fileData || !docToProcess.originalType) {
                toast({variant: "destructive", title: "OCR Error", description: "Image data or original type missing from DB."});
                if(isMountedRef.current) setIsPerformingOcr(false);
                return;
            }
            dataUrlToProcess = await IndexedDBService.arrayBufferToBase64DataURL(docToProcess.fileData, docToProcess.originalType);
        } catch (conversionError: any) {
          toast({variant: "destructive", title: "OCR Error", description: `Image preparation failed: ${conversionError.message}`});
          if(isMountedRef.current) setIsPerformingOcr(false);
          return;
        }
    }

    if (!dataUrlToProcess) {
      toast({ variant: "destructive", title: "OCR Error", description: "No image data available for OCR (check PDF page or ensure image is loaded)." });
      if(isMountedRef.current && isPerformingOcr) setIsPerformingOcr(false);
      return;
    }

    if(!isPerformingOcr && isMountedRef.current) setIsPerformingOcr(true);
    if(isMountedRef.current) setCurrentTextForTTS("Performing OCR...");

    try {
        const result = await performOCR(dataUrlToProcess);
        if(!isMountedRef.current) return;

        if ('extractedText' in result) {
            const ocrText = result.extractedText || "OCR completed, no text found.";
            setCurrentTextForTTS(ocrText);
            const docFromDB = await IndexedDBService.getDocumentById(currentActiveDoc.id);
            if (!docFromDB) {
                toast({ variant: "destructive", title: "OCR Save Error", description: "Document disappeared from DB before saving OCR text." });
                setIsPerformingOcr(false); return;
            }

            let updatedDocForSave: StoredMangaDocument = { ...docFromDB };
            if (updatedDocForSave.type === 'image') {
                (updatedDocForSave as StoredImageDocument).extractedText = ocrText;
            } else if (updatedDocForSave.type === 'pdf') {
                const ocrPages = { ...((updatedDocForSave as StoredPdfDocument).ocrTextPerPage || {}), [currentPdfPageNum]: ocrText };
                (updatedDocForSave as StoredPdfDocument).ocrTextPerPage = ocrPages;
                if(isMountedRef.current) setPdfPageIsTextBased(false);
            }

            await IndexedDBService.saveDocument(updatedDocForSave);
            if(isMountedRef.current) setActiveDoc(updatedDocForSave as ActiveMangaDocument);
            toast({ title: "OCR Successful", description: "Text extracted and saved."});

        } else {
            setCurrentTextForTTS(""); setDocErrorMessage(`OCR Error: ${result.error}`);
            toast({ variant: "destructive", title: "OCR Error", description: result.error });
        }
    } catch (e: any) {
      if(isMountedRef.current) {
        setCurrentTextForTTS(""); setDocErrorMessage(`OCR failed: ${e.message}`);
        toast({ variant: "destructive", title: "OCR Failed", description: e.message });
      }
    } finally {
      if(isMountedRef.current) setIsPerformingOcr(false);
    }
  }, [activeDoc, pdfPageImage, pdfPageIsTextBased, currentPdfPageNum, stopSpeech, toast]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const loadedSettings = LocalStorageService.loadTTSSettings();
      const engine = loadedSettings.engine || loadedSettings.type || 'local';
      if (isMountedRef.current) setTtsSettings(prev => ({ ...prev, ...loadedSettings, type: engine, engine: engine }));
    }
  }, []);

  const populateVoiceList = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const voices = window.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService, default: v.default }));
      if(isMountedRef.current) setAvailableVoices(voices);
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
                const defaultForLang = systemVoices.find(v => v.lang === settingsToSave.language && v.default) ||
                                     systemVoices.find(v => v.lang === settingsToSave.language) ||
                                     systemVoices.find(v => v.lang?.startsWith(settingsToSave.language.split('-')[0]) && v.default) ||
                                     systemVoices.find(v => v.lang?.startsWith(settingsToSave.language.split('-')[0]));

                if (defaultForLang && defaultForLang.lang) {
                    voiceToSet = defaultForLang;
                    langToSet = defaultForLang.lang;
                } else {
                    const absoluteFallback = systemVoices.find(v => v.default && v.lang) || (systemVoices.length > 0 ? systemVoices[0] : undefined);
                    if (absoluteFallback && absoluteFallback.lang) {
                        voiceToSet = absoluteFallback;
                        langToSet = absoluteFallback.lang;
                    } else {
                        voiceToSet = undefined;
                    }
                }
            }
            const newVoiceURI = voiceToSet ? voiceToSet.voiceURI : undefined;
            if (newVoiceURI !== settingsToSave.voiceURI) { settingsToSave.voiceURI = newVoiceURI; changesMadeToSettingsState = true; }
            if (langToSet && langToSet !== settingsToSave.language) { settingsToSave.language = langToSet; changesMadeToSettingsState = true; }
        } else {
            if(settingsToSave.voiceURI !== undefined) { settingsToSave.voiceURI = undefined; changesMadeToSettingsState = true; }
        }
    } else if (settingsToSave.engine === 'cloud') {
        if (settingsToSave.voiceURI !== undefined) { settingsToSave.voiceURI = undefined; changesMadeToSettingsState = true; }
    }
    let settingsChangedForLocalStorage = changesMadeToSettingsState ||
                          settingsToSave.rate !== ttsSettings.rate ||
                          settingsToSave.pitch !== ttsSettings.pitch ||
                          settingsToSave.engine !== ttsSettings.engine ||
                          settingsToSave.language !== ttsSettings.language ||
                          settingsToSave.type !== ttsSettings.type;


    if (changesMadeToSettingsState && isMountedRef.current) {
      setTtsSettings(settingsToSave);
    }
    if (settingsChangedForLocalStorage) {
      LocalStorageService.saveTTSSettings(settingsToSave);
    }
}, [ttsSettings.engine, ttsSettings.language, ttsSettings.rate, ttsSettings.pitch, ttsSettings.type, ttsSettings.voiceURI, availableVoices]);


  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;

    const handleAudioEnded = () => {
      if (audioPlayerRef.current === player && isSpeaking && ttsSettings.engine === 'cloud' && isMountedRef.current) {
        stopSpeech(true);
      }
    };
    const handleAudioPlaying = () => {
      if (audioPlayerRef.current === player && ttsSettings.engine === 'cloud' && isSpeaking && isMountedRef.current) {
        setIsLoadingTTS(false);
      }
    };
    const handleAudioError = (e: Event) => {
      if (audioPlayerRef.current === player && isSpeaking && ttsSettings.engine === 'cloud' && isMountedRef.current) {
        toast({variant: "destructive", title: "Audio Error", description: "Failed to play cloud TTS audio."});
        stopSpeech(true);
      }
    };

    player.addEventListener('ended', handleAudioEnded);
    player.addEventListener('playing', handleAudioPlaying);
    player.addEventListener('error', handleAudioError);

    return () => {
        player.removeEventListener('ended', handleAudioEnded);
        player.removeEventListener('playing', handleAudioPlaying);
        player.removeEventListener('error', handleAudioError);
        if (player.src && !player.paused) player.pause();
        player.src = "";
        if (audioPlayerRef.current === player) audioPlayerRef.current = null;
    };
  }, [ttsSettings.engine, isSpeaking, stopSpeech, toast]);

  const playPauseSpeech = async () => {
    if(!isMountedRef.current) return;

    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    const selectedTextFromSelection = selection?.toString().trim();
    const effectiveTextToRead = selectedTextFromSelection || currentTextForTTS;

    const invalidMessages = [ "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...", "Image loaded. Perform OCR", "No text content found", "Could not extract text", "EPUB viewer element not ready", "This PDF page has no selectable text", "Performing OCR...", "No document ID provided", "Document with ID", "EPUB viewer became unavailable.", "OCR completed, but no text found.", "No document selected.", "EPUB section loaded. Text may be graphical or empty." , "Could not load EPUB section content."];
    if (!effectiveTextToRead || invalidMessages.some(msg => effectiveTextToRead.startsWith(msg)) || effectiveTextToRead.length < MIN_TTS_TEXT_LENGTH) {
      toast({ variant: "destructive", title: "No Valid Text", description: `No valid text to read or text too short (min ${MIN_TTS_TEXT_LENGTH} chars). Selected: "${selectedTextFromSelection ? selectedTextFromSelection.substring(0,30)+'...' : ''}", Current: "${currentTextForTTS.substring(0,30)}..."` }); return;
    }

    if (isSpeaking) {
      if (isPaused) {
        if (ttsSettings.engine === 'local' && utteranceRef.current && window.speechSynthesis?.paused) {
          window.speechSynthesis.resume();
          if(isMountedRef.current) setIsPaused(false);
        } else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current?.paused) {
          audioPlayerRef.current.play().then(() => {if(isMountedRef.current) setIsPaused(false);}).catch(() => {if(isMountedRef.current) stopSpeech(true);});
        }
      } else {
        if (ttsSettings.engine === 'local' && utteranceRef.current && window.speechSynthesis?.speaking) {
          window.speechSynthesis.pause();
          if(isMountedRef.current) setIsPaused(true);
        } else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current && !audioPlayerRef.current.paused) {
          audioPlayerRef.current.pause();
          if(isMountedRef.current) setIsPaused(true);
        }
      }
    } else {
      stopSpeech(false);
      if(isMountedRef.current) { setIsLoadingTTS(true); setIsSpeaking(true); setIsPaused(false); }

      if (ttsSettings.engine === 'local') {
        if (typeof window === 'undefined' || !window.speechSynthesis) { toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." }); stopSpeech(true); return; }

        const utterance = new SpeechSynthesisUtterance(effectiveTextToRead);
        utterance.lang = ttsSettings.language;
        utterance.pitch = ttsSettings.pitch;
        utterance.rate = ttsSettings.rate;

        const systemVoices = window.speechSynthesis.getVoices();
        let voiceToUse: SpeechSynthesisVoice | undefined = undefined;
        if (systemVoices.length > 0) {
            if (ttsSettings.voiceURI) voiceToUse = systemVoices.find(v => v.voiceURI === ttsSettings.voiceURI && v.lang.startsWith(ttsSettings.language.split('-')[0]));
            if (!voiceToUse && ttsSettings.language) {
                 voiceToUse = systemVoices.find(v => v.lang === ttsSettings.language && v.default) ||
                              systemVoices.find(v => v.lang === ttsSettings.language) ||
                              systemVoices.find(v => v.lang?.startsWith(ttsSettings.language.split('-')[0]) && v.default) ||
                              systemVoices.find(v => v.lang?.startsWith(ttsSettings.language.split('-')[0]));
            }
            if (!voiceToUse) voiceToUse = systemVoices.find(v => v.default && v.lang) || (systemVoices.length > 0 ? systemVoices[0] : undefined);
        }

        if (voiceToUse) utterance.voice = voiceToUse;
        else if (availableVoices.length === 0 && systemVoices.length === 0) {
             toast({variant: "destructive", title: "TTS Error", description: "No speech synthesis voices available in this browser."}); stopSpeech(true); return;
        }
        utterance.onend = () => { if(utteranceRef.current === utterance && isMountedRef.current) stopSpeech(true); };
        utterance.onerror = (event) => { if(utteranceRef.current === utterance && isMountedRef.current) { toast({ variant: "destructive", title: "TTS Error", description: event.error || "Speech failed." }); stopSpeech(true); }};

        utteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
        if(isMountedRef.current) setIsLoadingTTS(false);

      } else {
        try {
          const result = await getCloudSpeech(effectiveTextToRead, ttsSettings.language);
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
            stopSpeech(true);
          }
        }
      }
    }
  };

  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    if(!isMountedRef.current) return;
    stopSpeech(true);

    setTtsSettings(prevSettings => {
        let newSettings = { ...prevSettings, [key]: value };
        if (key === 'engine') newSettings.type = value as 'local' | 'cloud';
        if (key === 'type') newSettings.engine = value as 'local' | 'cloud';
        if ((key === 'engine' || key === 'type') && newSettings.engine === 'cloud') {
            newSettings.voiceURI = undefined;
        }
        return newSettings;
    });
  };

  const handleFavoriteSelection = () => {
    if(!isMountedRef.current) return;
    const selectionFromWindow = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const textToFavorite = selectionFromWindow || currentTextForTTS;

    const invalidMessages = [ "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...", "Image loaded. Perform OCR", "No text content found", "Could not extract text", "EPUB viewer element not ready", "This PDF page has no selectable text", "Performing OCR...", "No document ID provided", "Document with ID", "EPUB viewer became unavailable.", "OCR completed, but no text found.", "No document selected.", "EPUB section loaded. Text may be graphical or empty." , "Could not load EPUB section content."];
    if (textToFavorite && activeDoc && !invalidMessages.some(msg => textToFavorite.startsWith(msg)) && textToFavorite.length >= MIN_TTS_TEXT_LENGTH) {
      LocalStorageService.addFavoriteItem({
        id: Date.now().toString(),
        text: textToFavorite,
        sourceDocumentId: activeDoc.id,
        sourceDocumentName: activeDoc.title,
        createdAt: Date.now()
      });
      toast({ title: "Favorited!", description: `"${textToFavorite.substring(0,50)}..." added.`});
    } else {
      toast({ variant: "destructive", title: "No Valid Text to Favorite", description: `Ensure valid text (min ${MIN_TTS_TEXT_LENGTH} chars) is available in the text area or selected on the page.` });
    }
  };

  const navigatePdf = (direction: 'prev' | 'next') => {
    console.log(`[ReaderPage] navigatePdf called with direction: ${direction}. Current page: ${currentPdfPageNum}, Total pages: ${pdfTotalPages}, isLoadingDoc: ${isLoadingDoc}, isRenderingPdfPage: ${isRenderingPdfPage}`);
    if (!pdfDocProxy || isRenderingPdfPage || isLoadingDoc || !isMountedRef.current) {
      console.warn(`[ReaderPage] navigatePdf: Navigation blocked. pdfDocProxy: ${!!pdfDocProxy}, isRenderingPdfPage: ${isRenderingPdfPage}, isLoadingDoc: ${isLoadingDoc}, isMounted: ${isMountedRef.current}`);
      return;
    }
    let newPage = currentPdfPageNum;
    if (direction === 'prev' && currentPdfPageNum > 1) {
      newPage--;
    } else if (direction === 'next' && currentPdfPageNum < pdfTotalPages) {
      newPage++;
    } else {
        console.log(`[ReaderPage] navigatePdf: Already at first/last page or invalid direction. current: ${currentPdfPageNum}, total: ${pdfTotalPages}, dir: ${direction}`);
        return;
    }

    console.log(`[ReaderPage] navigatePdf: Calculated newPage: ${newPage}. (Old page was ${currentPdfPageNum})`);
    if (newPage !== currentPdfPageNum) {
      stopSpeech(true);
      if(isMountedRef.current) setCurrentPdfPageNum(newPage);
      console.log(`[ReaderPage] navigatePdf: setCurrentPdfPageNum called with ${newPage}.`);
    } else {
      console.log(`[ReaderPage] navigatePdf: newPage is the same as currentPdfPageNum. No navigation action taken.`);
    }
  };
  const handlePdfScaleChange = (newScale: number) => { if (isRenderingPdfPage || !isMountedRef.current) return; stopSpeech(true); if(isMountedRef.current) setPdfScale(newScale); };

  const navigateEpub = async (direction: 'prev' | 'next') => {
    if(!isMountedRef.current) return;
    
    const navConditionDetails = {
        hasRendition: !!epubRenditionRef.current,
        managerActive: !!(epubRenditionRef.current && epubRenditionRef.current.manager?.active),
        isSectionDisplayedState: isEpubSectionDisplayed,
        hasViewerRef: !!epubViewerRef.current,
        isViewerInDom: !!(epubViewerRef.current && document.body.contains(epubViewerRef.current))
    };
    console.warn("[EPUB Nav] Navigation pre-conditions check. Values:", navConditionDetails);
    
    if (!navConditionDetails.hasRendition || !navConditionDetails.managerActive || !navConditionDetails.isSectionDisplayedState || !navConditionDetails.hasViewerRef || !navConditionDetails.isViewerInDom) {
        console.warn("[EPUB Nav] One or more pre-conditions FAILED, leading to 'not ready' toast.");
        toast({ variant: "default", title: "EPUB State", description: "EPUB reader is not ready for navigation. Please wait."});
        return;
    }

    stopSpeech(true);
    console.log(`[EPUB Nav] Calling rendition.${direction}()`);
    try {
      if (direction === 'prev') {
        await epubRenditionRef.current!.prev();
      } else {
        await epubRenditionRef.current!.next();
      }
      console.log(`[EPUB Nav] rendition.${direction}() completed successfully.`);
    } catch (error) {
      console.error(`[EPUB Nav] Error during rendition.${direction}():`, error);
      toast({
        variant: "destructive",
        title: "EPUB Navigation Error",
        description: `Failed to turn page: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  const handleEpubGoToSection = async () => {
    if (!epubBookRef.current || !epubRenditionRef.current || !epubGoToSectionInput) {
      toast({ variant: "destructive", title: "Error", description: "EPUB book or rendition not ready, or no section number entered." });
      return;
    }

    const sectionNumber = parseInt(epubGoToSectionInput, 10);
    const spineItems = epubBookRef.current.spine.items;

    if (isNaN(sectionNumber) || sectionNumber < 1 || sectionNumber > spineItems.length) {
      toast({
        variant: "destructive",
        title: "Invalid Section",
        description: `Please enter a section number between 1 and ${spineItems.length}.`,
      });
      return;
    }

    const targetSectionIndex = sectionNumber - 1; // Convert to 0-based index
    const targetHref = spineItems[targetSectionIndex]?.href;

    if (!targetHref) {
      toast({ variant: "destructive", title: "Error", description: "Could not find the target section." });
      return;
    }

    stopSpeech(true);
    console.log(`[EPUB Nav] Attempting to display section ${sectionNumber} (index ${targetSectionIndex}): ${targetHref}`);
    try {
      await epubRenditionRef.current.display(targetHref);
      if(isMountedRef.current) setEpubGoToSectionInput(""); // Clear input on success
      toast({ title: "Navigation", description: `Navigated to section ${sectionNumber}.` });
    } catch (error: any) {
      console.error(`[EPUB Nav] Error displaying section ${targetHref}:`, error);
      toast({
        variant: "destructive",
        title: "Navigation Error",
        description: `Failed to navigate to section ${sectionNumber}: ${error.message || String(error)}`,
      });
    }
  };

  const getButtonState = () => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const effectiveText = selectedText || currentTextForTTS;
    const invalidMessages = [ "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...", "Image loaded. Perform OCR", "No text content found", "Could not extract text", "EPUB viewer element not ready", "This PDF page has no selectable text", "Performing OCR...", "No document ID provided", "Document with ID", "EPUB viewer became unavailable.", "OCR completed, but no text found.", "No document selected.", "EPUB section loaded. Text may be graphical or empty.", "Could not load EPUB section content."];
    let canPlay = !!(effectiveText && !invalidMessages.some(msg => effectiveText.startsWith(msg)) && effectiveText.length >= MIN_TTS_TEXT_LENGTH && activeDoc && !isPerformingOcr && !docErrorMessage );

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

  if (isLoadingDoc && !activeDoc && !docErrorMessage && !isEpubLoading && !isRenderingPdfPage) {
    return <div className="flex items-center justify-center h-full flex-grow"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-lg">Loading document...</p></div>;
  }
  if (docErrorMessage && (!activeDoc || (activeDoc && !['pdf', 'epub', 'txt', 'image'].includes(activeDoc.type))) ) {
    return <div className="flex flex-col items-center justify-center h-full flex-grow p-4 text-center"> <AlertTriangle className="h-12 w-12 text-destructive mb-4" /> <h2 className="text-xl font-semibold mb-2">Error Loading Document</h2> <p className="text-muted-foreground mb-4">{docErrorMessage}</p> <Button onClick={() => router.push('/library')}>Go to Library</Button> </div>;
  }

  const showOcrButtonForPdfPage = activeDoc?.type === 'pdf' && !pdfPageIsTextBased && pdfPageImage && !isRenderingPdfPage && !isLoadingDoc && !isPerformingOcr;
  const showOcrButtonForImage = activeDoc?.type === 'image' && displayedImageSrc && !isLoadingDoc && !isPerformingOcr && !(activeDoc as StoredImageDocument).extractedText;

  return (
    <div className="flex flex-col lg:flex-row w-full h-[calc(100vh-4rem)]"> {/* Full height minus header */}
      {/* Content Area */}
      <div className="flex-grow overflow-y-auto bg-muted/20 p-2 md:p-4 relative">
         {docErrorMessage && activeDoc && (activeDoc.type === 'epub' || activeDoc.type === 'pdf') && (
            <div className="absolute inset-x-0 top-4 mx-auto w-fit max-w-md bg-destructive/10 border border-destructive text-destructive p-3 rounded-md shadow-lg z-10 flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div>
                    <p className="font-medium text-sm">Document Display Issue</p>
                    <p className="text-xs">{docErrorMessage}</p>
                    <Button variant="ghost" size="sm" className="text-xs h-auto p-1 mt-1 text-destructive hover:bg-destructive/20" onClick={() => {if(isMountedRef.current) setDocErrorMessage(null);}}>Dismiss</Button>
                </div>
            </div>
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

        {activeDoc?.type === 'epub' && (
            <div
                key={activeDoc?.id || 'no-epub-doc'} 
                ref={epubViewerRef}
                className={cn("w-full h-full epub-viewer-container bg-background rounded-md shadow-inner", (isLoadingDoc || isEpubLoading) && !isEpubSectionDisplayed && "flex items-center justify-center", !isEpubLoading && !isEpubSectionDisplayed && docErrorMessage && activeDoc.type === 'epub' && "p-4 text-center" )}
            >
                {(isLoadingDoc || isEpubLoading) && !isEpubSectionDisplayed && !docErrorMessage && <Loader2 className="h-10 w-10 animate-spin text-primary" />}
                {!isEpubLoading && !isEpubSectionDisplayed && docErrorMessage && activeDoc.type === 'epub' &&
                  <div className="text-destructive"> <AlertTriangle className="h-8 w-8 mx-auto mb-2"/> <p className="font-semibold">EPUB Load Error</p> <p className="text-sm">{docErrorMessage}</p> </div>
                }
            </div>
        )}

        {!isLoadingDoc && activeDoc?.type === 'txt' && (
          <pre className="whitespace-pre-wrap p-4 bg-background rounded-md shadow-inner text-sm font-mono h-full overflow-y-auto select-text">{txtContent}</pre>
        )}

        {!isLoadingDoc && activeDoc?.type === 'image' && displayedImageSrc && (
            <div className="flex flex-col items-center">
                <NextImage src={displayedImageSrc} alt={activeDoc.title || 'Uploaded Image'} width={800} height={600} style={{objectFit: 'contain'}} className="max-w-full max-h-[calc(100vh-15rem)] shadow-lg border rounded-md" data-ai-hint="illustration abstract" />
                {showOcrButtonForImage && <Button onClick={handlePerformOcr} disabled={isPerformingOcr} className="mt-3"> {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR on Image </Button> }
            </div>
        )}

         {!isLoadingDoc && activeDoc?.type === 'mobi' && (
           <div className="p-4 bg-background rounded-md shadow-inner text-center h-full flex flex-col justify-center items-center"> <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2"/> <p className="font-semibold">MOBI File Format Not Supported</p> <p className="text-sm text-muted-foreground">Please convert to EPUB or PDF.</p> </div>
         )}

        { (activeDoc?.type === 'pdf' || activeDoc?.type === 'epub' || activeDoc?.type === 'image' || activeDoc?.type === 'txt') && currentTextForTTS && !docErrorMessage && !isLoadingDoc && !isRenderingPdfPage && !isPerformingOcr && (!isEpubLoading || isEpubSectionDisplayed) &&
            <Card className="mt-4 sticky bottom-2 bg-background/90 backdrop-blur-sm shadow-md">
                <CardHeader className="pb-1 pt-3">
                    <CardTitle className="text-sm flex items-center"><FileText className="mr-2 h-4 w-4"/> Current Text for TTS</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                    <textarea readOnly value={currentTextForTTS} className="w-full h-20 p-2 border rounded-md bg-muted/30 text-xs select-text" placeholder="Text for TTS..." />
                </CardContent>
            </Card>
        }
      </div>

      <div className="w-full lg:w-80 xl:w-96 p-3 border-l bg-background flex-shrink-0 overflow-y-auto space-y-4">
        <Card>
            <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-base truncate flex items-center gap-1"> <BookOpen className="h-5 w-5 text-primary"/> {activeDoc?.title || "No Document Loaded"} </CardTitle>
                {activeDoc && <CardDescription className="text-xs">Type: {activeDoc.type.toUpperCase()}{activeDoc.type === 'pdf' && pdfTotalPages > 0 ? `, Page: ${currentPdfPageNum}/${pdfTotalPages}` : ''}{activeDoc.type === 'epub' && (isLoadingDoc || isEpubLoading) && !isEpubSectionDisplayed ? ` (Loading EPUB...)`: ''}</CardDescription>}
                {!activeDoc && !isLoadingDoc && !docErrorMessage && <CardDescription className="text-xs">No document loaded.</CardDescription>}
                {docErrorMessage && (!activeDoc || (activeDoc && (activeDoc.type === 'epub' || activeDoc.type === 'pdf'))) && <CardDescription className="text-xs text-destructive">{docErrorMessage}</CardDescription>}
            </CardHeader>
        </Card>

        {(activeDoc?.type === 'pdf' && pdfTotalPages > 0) && (
          <Card>
            <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">PDF Navigation & View</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-0">
              <div className="flex items-center justify-between">
                <Button onClick={() => navigatePdf('prev')} disabled={isLoadingDoc || isRenderingPdfPage || !pdfDocProxy || currentPdfPageNum <= 1} size="sm" variant="outline"><ChevronLeft /> Prev</Button>
                <span className="text-sm tabular-nums"> {currentPdfPageNum} / {pdfTotalPages}</span>
                <Button onClick={() => navigatePdf('next')} disabled={isLoadingDoc || isRenderingPdfPage || !pdfDocProxy || currentPdfPageNum >= pdfTotalPages} size="sm" variant="outline">Next <ChevronRight /></Button>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => handlePdfScaleChange(pdfScale - 0.25)} size="icon" variant="outline" className="h-7 w-7" disabled={isRenderingPdfPage || pdfScale <= 0.5 || isLoadingDoc}><ZoomOut className="h-4 w-4"/></Button>
                <Slider value={[pdfScale]} min={0.5} max={3} step={0.25} onValueChange={([val]) => handlePdfScaleChange(val)} disabled={isRenderingPdfPage || isLoadingDoc} />
                <Button onClick={() => handlePdfScaleChange(pdfScale + 0.25)} size="icon" variant="outline" className="h-7 w-7" disabled={isRenderingPdfPage || pdfScale >=3 || isLoadingDoc}><ZoomIn className="h-4 w-4"/></Button>
              </div>
            </CardContent>
          </Card>
        )}

        {activeDoc?.type === 'epub' && (
          <Card>
            <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">EPUB Navigation</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-center justify-between">
                <Button onClick={() => navigateEpub('prev')} size="sm" variant="outline"
                  disabled={isLoadingDoc || isEpubLoading || !epubRenditionRef.current }>
                  <ChevronLeft /> Previous
                </Button>
                <Button onClick={() => navigateEpub('next')} size="sm" variant="outline"
                  disabled={isLoadingDoc || isEpubLoading || !epubRenditionRef.current }>
                  Next <ChevronRight />
                </Button>
              </div>
              <div className="mt-3 space-y-1">
                <Label htmlFor="epub-goto-section" className="text-xs">Go to Section (1-based)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="epub-goto-section"
                    type="number"
                    value={epubGoToSectionInput}
                    onChange={(e) => setEpubGoToSectionInput(e.target.value)}
                    className="h-9 text-xs flex-grow"
                    placeholder={`1-${epubBookRef.current?.spine?.items?.length || 'N'}`}
                    min="1"
                    max={epubBookRef.current?.spine?.items?.length}
                    disabled={isLoadingDoc || isEpubLoading || !epubRenditionRef.current || !epubBookRef.current?.spine?.items}
                  />
                  <Button
                    size="sm"
                    onClick={handleEpubGoToSection}
                    disabled={isLoadingDoc || isEpubLoading || !epubRenditionRef.current || !epubBookRef.current?.spine?.items || !epubGoToSectionInput.trim()}
                    className="h-9 flex-shrink-0"
                  >
                    Go
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm flex items-center gap-1"><Settings2 className="h-4 w-4"/> Text-to-Speech</CardTitle></CardHeader>
          <CardContent className="space-y-2 pt-0">
            <div>
              <Label htmlFor="tts-engine" className="text-xs">Engine</Label>
              <Select value={ttsSettings.engine} onValueChange={(v) => handleSettingChange('engine', v as 'local' | 'cloud')} disabled={(isSpeaking && !isPaused) || isLoadingDoc || isRenderingPdfPage || isPerformingOcr || isEpubLoading || (activeDoc?.type === 'epub' && !isEpubSectionDisplayed) }>
                <SelectTrigger id="tts-engine" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="local"><div className="flex items-center gap-1 text-xs"><Smartphone className="h-3 w-3"/>Local</div></SelectItem><SelectItem value="cloud"><div className="flex items-center gap-1 text-xs"><CloudIcon className="h-3 w-3"/>Cloud</div></SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tts-language" className="text-xs">Language</Label>
              <Input id="tts-language" className="h-9 text-xs" value={ttsSettings.language} onChange={(e) => handleSettingChange('language', e.target.value)} disabled={(isSpeaking && !isPaused) || (ttsSettings.engine === 'local' && availableVoices.length === 0) || isLoadingDoc || isRenderingPdfPage || isPerformingOcr || isEpubLoading || (activeDoc?.type === 'epub' && !isEpubSectionDisplayed) } />
            </div>
            {ttsSettings.engine === 'local' && (
              <div>
                <Label htmlFor="tts-voice" className="text-xs">Voice (Local)</Label>
                <Select value={ttsSettings.voiceURI || ""} onValueChange={(v) => handleSettingChange('voiceURI', v)} disabled={(isSpeaking && !isPaused) || availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 || isLoadingDoc || isRenderingPdfPage || isPerformingOcr || isEpubLoading || (activeDoc?.type === 'epub' && !isEpubSectionDisplayed) }>
                  <SelectTrigger id="tts-voice" className="h-9 text-xs"><SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No voices"} /></SelectTrigger>
                  <SelectContent className="max-h-48">
                    {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).map(v => (<SelectItem key={v.voiceURI || v.name} value={v.voiceURI || ""} className="text-xs">{v.name} ({v.lang})</SelectItem>))}
                    {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (<SelectItem value="no-voice-reader" disabled className="text-xs">{availableVoices.length > 0 ? "No voices for lang" : "No local voices"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1"><Label htmlFor="tts-rate" className="text-xs">Rate: {ttsSettings.rate.toFixed(1)}</Label><Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={(isSpeaking && !isPaused) || isLoadingDoc || isRenderingPdfPage || isPerformingOcr || isEpubLoading || (activeDoc?.type === 'epub' && !isEpubSectionDisplayed) }/></div>
            <div className="space-y-1"><Label htmlFor="tts-pitch" className="text-xs">Pitch: {ttsSettings.pitch.toFixed(1)}</Label><Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={(isSpeaking && !isPaused) || isLoadingDoc || isRenderingPdfPage || isPerformingOcr || isEpubLoading || (activeDoc?.type === 'epub' && !isEpubSectionDisplayed) }/></div>
            <Button onClick={playPauseSpeech} disabled={buttonState.disabled} variant={isSpeaking && !isPaused ? "outline" : "default"} className="w-full h-9 text-sm">{buttonState.icon} {buttonState.text}</Button>
            <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="w-full mt-2 text-xs" disabled={!activeDoc || isLoadingDoc || isPerformingOcr || isRenderingPdfPage || docErrorMessage || (activeDoc?.type === 'epub' && (isEpubLoading || !isEpubSectionDisplayed)) }><Star className="mr-2 h-3 w-3" /> Favorite Text/Selection</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
    
    
