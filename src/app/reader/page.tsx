
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
    epubRenditionRef.current = null; // Nullify React ref immediately

    const bookToDestroy = epubBookRef.current;
    epubBookRef.current = null; // Nullify React ref immediately

    if (renditionToDestroy) {
        console.log("[EPUB Cleanup] Captured rendition instance for destruction. ID:", renditionToDestroy.book?.metadata?.identifier);
        // Check manager and destroy method before calling
        if (renditionToDestroy.manager && typeof renditionToDestroy.destroy === 'function') {
            requestAnimationFrame(() => {
                if (!isMountedRef.current) {
                    console.warn("[EPUB Cleanup/rAF] Component unmounted before rendition.destroy() for rendition ID:", renditionToDestroy.book?.metadata?.identifier);
                    return;
                }
                console.log("[EPUB Cleanup/rAF] Executing rendition.destroy() for rendition ID:", renditionToDestroy.book?.metadata?.identifier);
                try {
                    renditionToDestroy.destroy();
                    console.log("[EPUB Cleanup/rAF] rendition.destroy() completed for rendition ID:", renditionToDestroy.book?.metadata?.identifier);
                } catch (e: any) {
                    console.error("[EPUB Cleanup/rAF] Error during rendition.destroy() for rendition ID:", renditionToDestroy.book?.metadata?.identifier, e.message || e, e);
                }
            });
        } else {
            console.warn("[EPUB Cleanup] Skipping rendition.destroy() for rendition ID:", renditionToDestroy.book?.metadata?.identifier, "Rendition manager or destroy method missing. Manager exists:", !!renditionToDestroy.manager, "Destroy is function:", typeof renditionToDestroy.destroy === 'function');
        }
    } else {
        console.log("[EPUB Cleanup] No active rendition instance in ref to destroy.");
    }

    if (bookToDestroy) {
        console.log("[EPUB Cleanup] Captured book instance for destruction. ID:", bookToDestroy.metadata?.identifier);
        if (typeof bookToDestroy.destroy === 'function') {
            try {
                bookToDestroy.destroy();
                console.log("[EPUB Cleanup] Book instance destroyed. ID:", bookToDestroy.metadata?.identifier);
            } catch (e: any) {
                console.error("[EPUB Cleanup] Error destroying book instance ID:", bookToDestroy.metadata?.identifier, e.message || e, e);
            }
        } else {
             console.warn("[EPUB Cleanup] Book instance for ID:", bookToDestroy.metadata?.identifier, "missing destroy method.");
        }
    } else {
        console.log("[EPUB Cleanup] No active book instance in ref to destroy.");
    }

    if (isMountedRef.current) {
        setIsEpubSectionDisplayed(false);
        setCurrentTextForTTS("");
        setIsEpubLoading(false); // Ensure this is reset
    }
    console.log("[EPUB Cleanup] Completed cleanupEpubInstances.");
  }, []);


  useEffect(() => {
    console.log("[ReaderPage] Main document processing useEffect triggered. New docId from searchParams:", searchParams.get('docId'));
    
    const loadDocumentData = async () => {
      if (!isMountedRef.current) {
        console.log("[ReaderPage] Main useEffect: Component unmounted before loadDocumentData could run.");
        return;
      }

      stopSpeech(true);
      setDocErrorMessage(null);
      setIsLoadingDoc(true); // General loading flag
      setIsPerformingOcr(false);
      setCurrentTextForTTS("");

      // Cleanup for any previous document type
      if (pdfDocProxy) { 
        try { pdfDocProxy.destroy(); } catch(e) { console.warn("Error destroying PDF proxy on doc change", e); }
        setPdfDocProxy(null); setCurrentPdfPageNum(1); setPdfTotalPages(0); setPdfPageImage(null); setPdfPageIsTextBased(true); setIsRenderingPdfPage(false);
      }
      if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
      setDisplayedImageSrc(null);
      setTxtContent("");
      
      // Call cleanup for any previous EPUB *before* potentially loading a new one or switching type.
      // This is critical to ensure refs and EPUB.js state are cleared.
      // Do not call cleanup if the activeDoc IS an EPUB and we are just re-evaluating; 
      // cleanup for new EPUB load is handled within `initializeNewEpub` path.
      if (activeDoc && activeDoc.type === 'epub' && searchParams.get('docId') !== activeDoc.id) {
          console.log("[ReaderPage] Active document was EPUB, and docId changed. Calling cleanupEpubInstances before processing new document.");
          cleanupEpubInstances();
      } else if (activeDoc && activeDoc.type !== 'epub' && searchParams.get('docId')) {
          // If previous was not EPUB but we are loading a new doc, still good to ensure EPUB is clean.
          // This might be redundant if cleanup is always called when activeDoc changes to non-EPUB.
          console.log("[ReaderPage] Previous document was not EPUB, or new docId is present. Ensuring EPUB instances are clean.");
          cleanupEpubInstances();
      }


      let docIdToLoad = searchParams.get('docId');
      if (!docIdToLoad) {
        const lastActiveId = await IndexedDBService.getLastActiveDocId();
        if (lastActiveId) {
            docIdToLoad = lastActiveId;
            console.log(`[ReaderPage] No docId in params, using last active ID: ${docIdToLoad}`);
        } else {
          if(isMountedRef.current) { 
            setDocErrorMessage("No document selected. Please choose one from the Library."); 
            setIsLoadingDoc(false); 
            setActiveDoc(null); 
            cleanupEpubInstances(); 
          }
          return;
        }
      }
      
      let newActiveDoc: StoredMangaDocument | null = null;
      try {
        console.log(`[ReaderPage] Loading document metadata for ID: ${docIdToLoad}`);
        newActiveDoc = await IndexedDBService.getDocumentById(docIdToLoad!); 
        
        if (!newActiveDoc) {
          if(isMountedRef.current) { 
            setDocErrorMessage(`Document with ID "${docIdToLoad}" not found.`); 
            await IndexedDBService.saveLastActiveDocId(null); 
            setIsLoadingDoc(false); 
            setActiveDoc(null); 
            cleanupEpubInstances();
          }
          return;
        }
        
        if(isMountedRef.current) { 
            setActiveDoc(newActiveDoc as ActiveMangaDocument); 
        } 
        await IndexedDBService.saveLastActiveDocId(docIdToLoad!);

        // Document type specific loading logic
        if (newActiveDoc.type === 'pdf') {
            if(isMountedRef.current) setCurrentTextForTTS("Loading PDF...");
            // PDF specific loading will be handled by its dedicated useEffect based on activeDoc
        } else if (newActiveDoc.type === 'epub') {
            if(isMountedRef.current) {
                // isEpubLoading will be true here from initializeNewEpub if it's called
                // If initializeNewEpub is not called yet, setting this ensures UI shows loading
                if (!isEpubLoading) setIsEpubLoading(true);
                setCurrentTextForTTS("Loading EPUB...");
                // initializeNewEpub will be called by the useEffect dependent on activeDoc
            }
        } else if (newActiveDoc.type === 'txt') {
            if(isMountedRef.current) setCurrentTextForTTS("Loading text file...");
            try {
                const decoder = new TextDecoder();
                const text = decoder.decode(newActiveDoc.fileData);
                if(isMountedRef.current) { setTxtContent(text); setCurrentTextForTTS(text); }
            } catch (e: any) {
                if(isMountedRef.current) { setDocErrorMessage(`Failed to decode TXT file: ${e.message}`); setCurrentTextForTTS(""); }
            } finally {
                if(isMountedRef.current) setIsLoadingDoc(false); // TXT is quick
            }
        } else if (newActiveDoc.type === 'image') {
            if(isMountedRef.current) setCurrentTextForTTS("Loading image...");
            try {
                const blob = new Blob([newActiveDoc.fileData], { type: newActiveDoc.originalType });
                if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); }
                const newUrl = URL.createObjectURL(blob);
                currentImageObjectUrlRef.current = newUrl;
                if(isMountedRef.current) setDisplayedImageSrc(newUrl);

                const imageDoc = newActiveDoc as StoredImageDocument;
                if (imageDoc.extractedText) {
                    if(isMountedRef.current) setCurrentTextForTTS(imageDoc.extractedText);
                } else {
                    if(isMountedRef.current) setCurrentTextForTTS("Image loaded. Perform OCR to extract text for reading aloud.");
                }
            } catch (e: any) {
                if(isMountedRef.current) { setDocErrorMessage(`Failed to load image: ${e.message}`); setCurrentTextForTTS(""); }
            } finally {
                if(isMountedRef.current) setIsLoadingDoc(false); // Image is quick
            }
        } else if (newActiveDoc.type === 'mobi') {
            if (isMountedRef.current) {
                setDocErrorMessage("MOBI files are not directly viewable. Please convert to EPUB or PDF.");
                setCurrentTextForTTS("");
                setIsLoadingDoc(false);
            }
        } else {
             if(isMountedRef.current) setIsLoadingDoc(false); // Default case if no specific type loading
        }

      } catch (err: any) {
        if(isMountedRef.current) { 
            setDocErrorMessage(`Error loading document: ${err.message}`); 
            setIsLoadingDoc(false); 
            setActiveDoc(null); 
            cleanupEpubInstances(); // Ensure EPUB is cleared on error
        }
      }
    };
    
    loadDocumentData();

    return () => { // Cleanup for the main useEffect
      console.log("[ReaderPage] Main document processing useEffect UNMOUNT/CLEANUP. Calling cleanupEpubInstances.");
      cleanupEpubInstances();
      stopSpeech(true);
      if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
      if (pdfDocProxy) { try { pdfDocProxy.destroy(); } catch(e) { console.warn("Error destroying PDF proxy on main unmount", e);}}
      // Reset general loading states
      if (isMountedRef.current) {
        setIsLoadingDoc(true); // Set to true as we are "unloading"
        setActiveDoc(null);
        setDocErrorMessage(null);
      }
    };
  }, [searchParams, cleanupEpubInstances, stopSpeech]); 
  // activeDoc removed from deps to prevent re-triggering this whole effect on internal activeDoc updates (like OCR text)
  // We want it to run when searchParams (docId) changes.

  // PDF Loading Effect (only if activeDoc is PDF)
  useEffect(() => {
    if (activeDoc?.type === 'pdf' && activeDoc.fileData && isMountedRef.current) {
      console.log("[PDF Effect] Loading PDF document:", activeDoc.id);
      setIsLoadingDoc(true); // Set loading before async operation
      if (pdfDocProxy) { 
        try { pdfDocProxy.destroy(); } catch(e){console.warn("Error destroying previous pdfDocProxy", e);}
        setPdfDocProxy(null); // Ensure old proxy is cleared
      }

      getDocument({ data: activeDoc.fileData.slice(0) }).promise.then(pdf => {
        if(!isMountedRef.current || activeDoc?.type !== 'pdf') { 
             try {pdf.destroy();} catch(e){}
             console.log("[PDF Effect] PDF load no longer relevant (unmounted or doc changed).");
             if(isMountedRef.current) setIsLoadingDoc(false);
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
    } else if (activeDoc && activeDoc.type !== 'pdf' && pdfDocProxy) {
      // Clean up PDF if activeDoc changes to non-PDF
      try { pdfDocProxy.destroy(); } catch(e){console.warn("Error destroying pdfDocProxy on doc type change", e);}
      setPdfDocProxy(null);
    }
  }, [activeDoc]); // Only depends on activeDoc

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
            if(isMountedRef.current) {setIsRenderingPdfPage(false); setIsLoadingDoc(false);}
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
        if(isMountedRef.current) {setIsLoadingDoc(false); setIsRenderingPdfPage(false);}
      }).catch(e => {
        if(!isMountedRef.current) return;
        console.error(`[PDF Page Effect] Error rendering PDF page ${currentPdfPageNum}:`, e);
        setPdfPageImage(null); setCurrentTextForTTS(""); setDocErrorMessage(`Error rendering PDF page ${currentPdfPageNum}: ${e.message}`); setPdfPageIsTextBased(false); 
        if(isMountedRef.current) {setIsLoadingDoc(false); setIsRenderingPdfPage(false);}
      });
    }
  }, [activeDoc, pdfDocProxy, currentPdfPageNum, pdfScale, pdfTotalPages, stopSpeech]);


  // EPUB Initialization Function (called by useEffect when activeDoc is EPUB)
  const initializeNewEpub = useCallback(async () => {
    if (!isMountedRef.current || !activeDoc || activeDoc.type !== 'epub' || !activeDoc.fileData) {
        console.warn("[EPUB Init] Aborted: Conditions not met. ActiveDoc:", activeDoc, "Mounted:", isMountedRef.current);
        if (isMountedRef.current) { setIsLoadingDoc(false); setIsEpubLoading(false); }
        return;
    }
    console.log("[EPUB Init] Starting initialization for doc:", activeDoc.id);

    // Ensure any previous EPUB instances are thoroughly cleaned up *before* initializing new ones.
    // This is a safeguard, though the main useEffect's cleanup should also handle it.
    cleanupEpubInstances(); 

    if (!epubViewerRef.current) {
        console.warn("[EPUB Init] Aborted: epubViewerRef.current is null.");
        if (isMountedRef.current) { setIsLoadingDoc(false); setIsEpubLoading(false); setDocErrorMessage("EPUB viewer element not ready."); }
        return;
    }
    
    epubViewerRef.current.innerHTML = ''; 
    console.log("[EPUB Init] epubViewerRef.current.innerHTML cleared for doc:", activeDoc.id);

    if (isMountedRef.current) {
        setIsEpubLoading(true); // Set EPUB specific loading
        setIsEpubSectionDisplayed(false); 
        setCurrentTextForTTS("Loading EPUB...");
        setDocErrorMessage(null);
    }

    try {
        console.log("[EPUB Init] Importing epubjs for doc:", activeDoc.id);
        const ePubModule = await import('epubjs');
        const EPub = ePubModule.default;

        const book = EPub(activeDoc.fileData);
        if (!isMountedRef.current) { 
            console.warn("[EPUB Init] Unmounted during EPub() call. Doc:", activeDoc.id);
            try { book.destroy(); } catch (e) { console.warn("Book (from EPub call) destroyed due to unmount", e); } 
            if(isMountedRef.current) {setIsEpubLoading(false); setIsLoadingDoc(false);}
            return; 
        }
        
        console.log("[EPUB Init] New Book instance created, waiting for book.ready. Doc:", activeDoc.id);
        epubBookRef.current = book; // Set ref immediately for potential early cleanup

        await book.ready;
        if (!isMountedRef.current || epubBookRef.current !== book) { // Check if still relevant
             console.warn("[EPUB Init] Unmounted or book ref changed after book.ready. Aborting. Doc:", activeDoc.id); 
             if (book && typeof book.destroy === 'function') try { book.destroy(); } catch(e){ console.warn("Book (from after ready) destroyed due to unmount/change", e);}
             if (epubBookRef.current === book) epubBookRef.current = null; // Clear if it was this book
             if(isMountedRef.current) {setIsEpubLoading(false); setIsLoadingDoc(false);}
             return;
        }
        console.log("[EPUB Init] Book is ready. Doc:", activeDoc.id);


        if (!epubViewerRef.current || !document.body.contains(epubViewerRef.current)) {
             console.warn("[EPUB Init] Viewer detached or unavailable before rendering. Aborting. Doc:", activeDoc.id);
             if(isMountedRef.current) { setDocErrorMessage("EPUB viewer became unavailable."); setIsEpubLoading(false); setIsLoadingDoc(false); }
             return;
        }
        
        const rendition = book.renderTo(epubViewerRef.current, { width: "100%", height: "100%", flow: "paginated", spread: "auto" });
        if (!isMountedRef.current) { 
            console.warn("[EPUB Init] Unmounted during renderTo() call. Doc:", activeDoc.id);
            if (rendition && typeof rendition.destroy === 'function') try { rendition.destroy(); } catch (e) { console.warn("Rendition (from renderTo) destroyed due to unmount", e);} 
            if(isMountedRef.current) {setIsEpubLoading(false); setIsLoadingDoc(false);}
            return; 
        }
        epubRenditionRef.current = rendition; // Set ref immediately
        console.log("[EPUB Init] New Rendition instance created and ref set. Doc:", activeDoc.id);

        rendition.on('displayed', async (sectionResult: any) => {
            if (!isMountedRef.current || epubRenditionRef.current !== rendition || !activeDoc || activeDoc.type !== 'epub') {
                console.log("[EPUB Displayed Event] Conditions not met or stale rendition. Aborting. Current rendition ref might be different. Doc:", activeDoc?.id); return;
            }
            console.log(`[EPUB Displayed Event] Section displayed: ${sectionResult?.href}. Manager active: ${epubRenditionRef.current?.manager?.active}. Doc: ${activeDoc.id}`);
            
            try {
                const displayedContents = await rendition.getContents();
                let extractedText = "";

                if (displayedContents && displayedContents.length > 0 && displayedContents[0]) {
                    const sectionDocument = displayedContents[0].document;
                    if (sectionDocument?.body?.innerText) {
                       extractedText = sectionDocument.body.innerText.replace(/\s+/g, ' ').trim();
                    } else {
                        console.warn("[EPUB Displayed Event] sectionDocument.body.innerText not available. Doc:", activeDoc.id);
                    }
                } else {
                     console.warn("[EPUB Displayed Event] getContents() returned empty or invalid. Doc:", activeDoc.id);
                }

                if (isMountedRef.current) { 
                    setCurrentTextForTTS(extractedText && extractedText.length >= MIN_TTS_TEXT_LENGTH ? extractedText : "EPUB section loaded. Text may be graphical or empty.");
                    setIsEpubSectionDisplayed(true); 
                    console.log("[EPUB Displayed Event] isEpubSectionDisplayed set to true. Text length:", extractedText.length, "Doc:", activeDoc.id);
                }
            } catch (textExtractError: any) {
                console.error("[EPUB Displayed Event] Error extracting text:", textExtractError, "Doc:", activeDoc.id);
                if (isMountedRef.current) { setCurrentTextForTTS(""); setDocErrorMessage(`Error extracting EPUB text: ${textExtractError.message}`); setIsEpubSectionDisplayed(true); }
            }
        });
        
        rendition.on('removed', (section: any) => { console.log('[EPUB Removed Event] Section removed:', section?.id, 'for doc:', activeDoc?.id); });
        rendition.on('resized', (size: {width: number, height: number}) => { console.log('[EPUB Resized Event] New size:', size, 'for doc:', activeDoc?.id); });
        rendition.on('orientationchange', (orientation: string) => { console.log('[EPUB Orientation Change Event] New orientation:', orientation, 'for doc:', activeDoc?.id); });

        console.log("[EPUB Init] Attempting rendition.display() for doc:", activeDoc.id);
        await rendition.display(); 
        if (!isMountedRef.current || epubRenditionRef.current !== rendition) { 
            console.warn("[EPUB Init] Stale rendition instance after display or unmounted. Aborting. Doc:", activeDoc.id); 
            if(isMountedRef.current) {setIsEpubLoading(false); setIsLoadingDoc(false);}
            return; 
        }
        console.log(`[EPUB Init] rendition.display() completed. Manager Active: ${rendition.manager?.active}. For doc: ${activeDoc.id}`);

    } catch (e: any) {
        console.error("[EPUB Init] Error during EPUB initialization for doc:", activeDoc?.id, e);
        if (isMountedRef.current) {
            setDocErrorMessage(`Failed to load EPUB: ${e.message || String(e)}`);
            setCurrentTextForTTS("");
            cleanupEpubInstances(); // Ensure full cleanup on init error
        }
    } finally {
        if (isMountedRef.current) {
            setIsEpubLoading(false); // Specific EPUB loading done
            setIsLoadingDoc(false);  // General doc loading done for EPUB
            console.log("[EPUB Init] Finally block: isEpubLoading and isLoadingDoc set to false. For doc:", activeDoc?.id);
        }
    }
  }, [activeDoc, cleanupEpubInstances]); // Depends on activeDoc and cleanupEpubInstances

  // Effect to call initializeNewEpub when activeDoc changes to an EPUB
  useEffect(() => {
    if (activeDoc?.type === 'epub' && activeDoc.fileData && isMountedRef.current) {
        console.log("[EPUB Init Trigger Effect] Conditions met to call initializeNewEpub. activeDoc.id:", activeDoc.id);
        initializeNewEpub();
    } else if (activeDoc && activeDoc.type !== 'epub') {
        // If activeDoc changes to something other than EPUB, ensure EPUB is cleaned up
        console.log("[EPUB Init Trigger Effect] Active document is not EPUB. Ensuring EPUB instances are clean.");
        cleanupEpubInstances();
    }
  }, [activeDoc, initializeNewEpub, cleanupEpubInstances]);


  const handlePerformOcr = useCallback(async () => {
    if (!activeDoc) { toast({ variant: "destructive", title: "OCR Error", description: "No active document." }); return; }
    if (!isMountedRef.current) return;
    stopSpeech(true);
    let dataUrlToProcess: string | null = null;
    const currentActiveDoc = activeDoc; // Capture current activeDoc

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
            if (isMountedRef.current && activeDoc && activeDoc.id === updatedDocForSave.id) {
                 setActiveDoc(updatedDocForSave as ActiveMangaDocument);
            }
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

  // TTS Settings and Voice List Effects
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
    let currentSettings = { ...ttsSettings }; 
    let settingsChanged = false;

    if (typeof window !== 'undefined' && window.speechSynthesis && currentSettings.engine === 'local') {
        const systemVoices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService, default: v.default }));

        if (systemVoices.length > 0) {
            let voiceToSet: TTSVoice | undefined = currentSettings.voiceURI ? systemVoices.find(v => v.voiceURI === currentSettings.voiceURI) : undefined;
            let langToSet = currentSettings.language;
            const currentVoiceIsValidForLanguage = voiceToSet && voiceToSet.lang && (voiceToSet.lang === currentSettings.language || voiceToSet.lang.startsWith(currentSettings.language.split('-')[0]));

            if (!voiceToSet || !currentVoiceIsValidForLanguage) {
                const defaultForLang = systemVoices.find(v => v.lang === currentSettings.language && v.default) ||
                                     systemVoices.find(v => v.lang === currentSettings.language) ||
                                     systemVoices.find(v => v.lang?.startsWith(currentSettings.language.split('-')[0]) && v.default) ||
                                     systemVoices.find(v => v.lang?.startsWith(currentSettings.language.split('-')[0]));

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
            if (newVoiceURI !== currentSettings.voiceURI) { currentSettings.voiceURI = newVoiceURI; settingsChanged = true; }
            if (langToSet && langToSet !== currentSettings.language) { currentSettings.language = langToSet; settingsChanged = true; }

        } else { 
            if(currentSettings.voiceURI !== undefined) { currentSettings.voiceURI = undefined; settingsChanged = true; }
        }
    } else if (currentSettings.engine === 'cloud') { 
        if (currentSettings.voiceURI !== undefined) { currentSettings.voiceURI = undefined; settingsChanged = true; } 
    }
    
    const needsStateUpdate = settingsChanged; 
    const needsLocalStorageSave = needsStateUpdate || 
                                  currentSettings.rate !== ttsSettings.rate ||
                                  currentSettings.pitch !== ttsSettings.pitch ||
                                  currentSettings.engine !== ttsSettings.engine ||
                                  currentSettings.type !== ttsSettings.type; 


    if (needsStateUpdate && isMountedRef.current) {
      setTtsSettings(currentSettings); 
    }
    if (needsLocalStorageSave) { 
      LocalStorageService.saveTTSSettings(currentSettings);
    }
}, [ttsSettings.engine, ttsSettings.language, ttsSettings.rate, ttsSettings.pitch, ttsSettings.type, availableVoices, ttsSettings.voiceURI]);


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

    const invalidMessages = [
        "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", 
        "Loading text file...", "Loading image...", "Image loaded. Perform OCR", 
        "No text content found", "Could not extract text", "EPUB viewer element not ready", 
        "This PDF page has no selectable text", "Performing OCR...", "No document ID provided", 
        "Document with ID", "EPUB viewer became unavailable.", "OCR completed, but no text found.", 
        "No document selected.", "EPUB section loaded. Text may be graphical or empty.",
        "Could not load EPUB section content.", "Waiting for page"
    ];
    if (!effectiveTextToRead || invalidMessages.some(msg => effectiveTextToRead.toLowerCase().startsWith(msg.toLowerCase())) || effectiveTextToRead.length < MIN_TTS_TEXT_LENGTH) {
      toast({ variant: "destructive", title: "No Valid Text", description: `No valid text to read or text too short (min ${MIN_TTS_TEXT_LENGTH} chars). Text was: "${effectiveTextToRead.substring(0,50)}..."` }); return;
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

    const invalidMessages = [ "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...", "Image loaded. Perform OCR", "No text content found", "Could not extract text", "EPUB viewer element not ready", "This PDF page has no selectable text", "Performing OCR...", "No document ID provided", "Document with ID", "EPUB viewer became unavailable.", "OCR completed, but no text found.", "No document selected.", "EPUB section loaded. Text may be graphical or empty.", "Could not load EPUB section content."];
    if (textToFavorite && activeDoc && !invalidMessages.some(msg => textToFavorite.toLowerCase().startsWith(msg.toLowerCase())) && textToFavorite.length >= MIN_TTS_TEXT_LENGTH) {
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
    if (!pdfDocProxy || isRenderingPdfPage || isLoadingDoc || !isMountedRef.current) return;
    let newPage = currentPdfPageNum;
    if (direction === 'prev' && currentPdfPageNum > 1) newPage--;
    else if (direction === 'next' && currentPdfPageNum < pdfTotalPages) newPage++;
    else return; 
    if (newPage !== currentPdfPageNum) { stopSpeech(true); if(isMountedRef.current) setCurrentPdfPageNum(newPage); }
  };
  const handlePdfScaleChange = (newScale: number) => { if (isRenderingPdfPage || !isMountedRef.current) return; stopSpeech(true); if(isMountedRef.current) setPdfScale(newScale); };

  const navigateEpub = async (direction: 'prev' | 'next') => {
    if (!isMountedRef.current || !epubRenditionRef.current) {
        console.warn("[EPUB Nav] Aborted: Unmounted or no rendition ref.");
        return;
    }

    const navConditionDetails = {
        hasRendition: !!epubRenditionRef.current,
        managerActive: !!(epubRenditionRef.current?.manager?.active),
        isSectionDisplayedState: isEpubSectionDisplayed,
        hasViewerRef: !!epubViewerRef.current,
        isViewerInDom: !!(epubViewerRef.current && document.body.contains(epubViewerRef.current))
    };
    
    if (!navConditionDetails.hasRendition || !navConditionDetails.managerActive || !navConditionDetails.isSectionDisplayedState || !navConditionDetails.hasViewerRef || !navConditionDetails.isViewerInDom) {
        console.warn("[EPUB Nav] Navigation pre-conditions FAILED. Values:", navConditionDetails);
        toast({ variant: "default", title: "EPUB State", description: "EPUB reader is not ready for navigation. Please wait or reload document."});
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

  const getButtonState = () => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const effectiveText = selectedText || currentTextForTTS;
    const invalidMessages = [ "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...", "Image loaded. Perform OCR", "No text content found", "Could not extract text", "EPUB viewer element not ready", "This PDF page has no selectable text", "Performing OCR...", "No document ID provided", "Document with ID", "EPUB viewer became unavailable.", "OCR completed, but no text found.", "No document selected.", "EPUB section loaded. Text may be graphical or empty.", "Could not load EPUB section content.", "Waiting for page"];
    let canPlay = !!(effectiveText && !invalidMessages.some(msg => effectiveText.toLowerCase().startsWith(msg.toLowerCase())) && effectiveText.length >= MIN_TTS_TEXT_LENGTH && activeDoc && !isPerformingOcr && !docErrorMessage );

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

        <div
            key={activeDoc?.id || 'no-epub-doc'} 
            ref={epubViewerRef}
            className={cn(
                "w-full h-full epub-viewer-container bg-background rounded-md shadow-inner", 
                (activeDoc?.type === 'epub' && (isLoadingDoc || isEpubLoading) && !isEpubSectionDisplayed && !docErrorMessage) && "flex items-center justify-center",
                (activeDoc?.type === 'epub' && !isEpubLoading && !isEpubSectionDisplayed && docErrorMessage) && "p-4 text-center"
            )}
        >
            {activeDoc?.type === 'epub' && (isLoadingDoc || isEpubLoading) && !isEpubSectionDisplayed && !docErrorMessage && 
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
            }
            {activeDoc?.type === 'epub' && !isEpubLoading && !isEpubSectionDisplayed && docErrorMessage &&
              <div className="text-destructive"> <AlertTriangle className="h-8 w-8 mx-auto mb-2"/> <p className="font-semibold">EPUB Load Error</p> <p className="text-sm">{docErrorMessage}</p> </div>
            }
        </div>

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

        { (activeDoc?.type === 'pdf' || activeDoc?.type === 'epub' || activeDoc?.type === 'image' || activeDoc?.type === 'txt') && 
          currentTextForTTS && !docErrorMessage && !isLoadingDoc && !isRenderingPdfPage && !isPerformingOcr && 
          (!isEpubLoading || isEpubSectionDisplayed) && 
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

      {/* Sidebar Area */}
      <div className="w-full lg:w-80 xl:w-96 p-3 border-l bg-background flex-shrink-0 overflow-y-auto space-y-4">
        <Card>
            <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-base truncate flex items-center gap-1"> <BookOpen className="h-5 w-5 text-primary"/> {activeDoc?.title || "No Document Loaded"} </CardTitle>
                {activeDoc && <CardDescription className="text-xs">Type: {activeDoc.type.toUpperCase()}{activeDoc.type === 'pdf' && pdfTotalPages > 0 ? `, Page: ${currentPdfPageNum}/${pdfTotalPages}` : ''}{activeDoc.type === 'epub' && (isLoadingDoc || isEpubLoading) && !isEpubSectionDisplayed ? ` (Loading EPUB...)`: ''}</CardDescription>}
                {!activeDoc && !isLoadingDoc && !docErrorMessage && <CardDescription className="text-xs">No document loaded.</CardDescription>}
                {docErrorMessage && (!activeDoc || (activeDoc && (activeDoc.type !== 'epub' && activeDoc.type !== 'pdf'))) && <CardDescription className="text-xs text-destructive">{docErrorMessage}</CardDescription>}
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
            <CardContent className="flex items-center justify-between pt-0">
                <Button onClick={() => navigateEpub('prev')} size="sm" variant="outline"
                  disabled={isLoadingDoc || isEpubLoading || !epubRenditionRef.current}>
                  <ChevronLeft /> Previous
                </Button>
                <Button onClick={() => navigateEpub('next')} size="sm" variant="outline"
                  disabled={isLoadingDoc || isEpubLoading || !epubRenditionRef.current}>
                  Next <ChevronRight />
                </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm flex items-center gap-1"><Settings2 className="h-4 w-4"/> Text-to-Speech</CardTitle></CardHeader>
          <CardContent className="space-y-2 pt-0">
            <div>
              <Label htmlFor="tts-engine" className="text-xs">Engine</Label>
              <Select value={ttsSettings.engine} onValueChange={(v) => handleSettingChange('engine', v as 'local' | 'cloud')} 
                disabled={(isSpeaking && !isPaused) || isLoadingDoc || isRenderingPdfPage || isPerformingOcr || isEpubLoading || (activeDoc?.type === 'epub' && !isEpubSectionDisplayed) }>
                <SelectTrigger id="tts-engine" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="local"><div className="flex items-center gap-1 text-xs"><Smartphone className="h-3 w-3"/>Local</div></SelectItem><SelectItem value="cloud"><div className="flex items-center gap-1 text-xs"><CloudIcon className="h-3 w-3"/>Cloud</div></SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tts-language" className="text-xs">Language</Label>
              <Input id="tts-language" className="h-9 text-xs" value={ttsSettings.language} onChange={(e) => handleSettingChange('language', e.target.value)} 
                disabled={(isSpeaking && !isPaused) || (ttsSettings.engine === 'local' && availableVoices.length === 0) || isLoadingDoc || isRenderingPdfPage || isPerformingOcr || isEpubLoading || (activeDoc?.type === 'epub' && !isEpubSectionDisplayed) } />
            </div>
            {ttsSettings.engine === 'local' && (
              <div>
                <Label htmlFor="tts-voice" className="text-xs">Voice (Local)</Label>
                <Select value={ttsSettings.voiceURI || ""} onValueChange={(v) => handleSettingChange('voiceURI', v)} 
                  disabled={(isSpeaking && !isPaused) || availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 || isLoadingDoc || isRenderingPdfPage || isPerformingOcr || isEpubLoading || (activeDoc?.type === 'epub' && !isEpubSectionDisplayed) }>
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
            <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="w-full mt-2 text-xs" 
              disabled={!activeDoc || isLoadingDoc || isPerformingOcr || isRenderingPdfPage || docErrorMessage || (activeDoc?.type === 'epub' && (isEpubLoading || !isEpubSectionDisplayed)) }>
              <Star className="mr-2 h-3 w-3" /> Favorite Text/Selection
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
    
    

