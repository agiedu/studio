
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
    if (epubRenditionRef.current) {
        epubRenditionRef.current = null; 
        console.log("[EPUB Cleanup] epubRenditionRef.current nulled.");
    }

    const bookToDestroy = epubBookRef.current;
    if (epubBookRef.current) {
        epubBookRef.current = null;
        console.log("[EPUB Cleanup] epubBookRef.current nulled.");
    }

    if (renditionToDestroy) {
        console.log("[EPUB Cleanup] Scheduling rendition.destroy() for previous rendition instance via rAF.");
        requestAnimationFrame(() => {
            if (!isMountedRef.current) {
                console.warn("[EPUB Cleanup/rAF] Component unmounted before rendition.destroy() could execute.");
                return;
            }
            console.log("[EPUB Cleanup/rAF] Executing rendition.destroy(). Rendition manager present:", !!renditionToDestroy.manager);
             if (typeof renditionToDestroy.destroy === 'function') {
                try {
                    renditionToDestroy.destroy();
                    console.log("[EPUB Cleanup/rAF] rendition.destroy() completed.");
                } catch (e: any) {
                    console.error("[EPUB Cleanup/rAF] Error during rendition.destroy():", e.message || e, e);
                }
            } else {
                 console.warn("[EPUB Cleanup/rAF] renditionToDestroy.destroy was not a function.");
            }
        });
    } else {
        console.log("[EPUB Cleanup] No active rendition instance (renditionToDestroy was null).");
    }
    
    if (bookToDestroy) {
        console.log("[EPUB Cleanup] Destroying book instance.");
        if (typeof bookToDestroy.destroy === 'function') {
            try {
                bookToDestroy.destroy();
                console.log("[EPUB Cleanup] Book instance destroyed.");
            } catch (e: any) {
                console.error("[EPUB Cleanup] Error destroying book instance:", e.message || e, e);
            }
        } else {
            console.warn("[EPUB Cleanup] bookToDestroy.destroy was not a function.");
        }
    } else {
        console.log("[EPUB Cleanup] No active book instance (bookToDestroy was null).");
    }
    
    if (isMountedRef.current) {
        setIsEpubSectionDisplayed(false);
        setCurrentTextForTTS("");
        // Do not clear epubViewerRef.current.innerHTML here, let React's key unmount handle it.
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
      setIsLoadingDoc(true);
      setIsPerformingOcr(false);
      setCurrentTextForTTS("");

      // Cleanup previous PDF state
      if (pdfDocProxy) { 
        try { pdfDocProxy.destroy(); } catch(e) { console.warn("Error destroying PDF proxy on doc change", e); }
        setPdfDocProxy(null); setCurrentPdfPageNum(1); setPdfTotalPages(0); setPdfPageImage(null); setPdfPageIsTextBased(true); setIsRenderingPdfPage(false);
      }
      // Cleanup previous image state
      if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
      setDisplayedImageSrc(null);
      // Cleanup previous TXT state
      setTxtContent("");

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
            cleanupEpubInstances(); // Ensure EPUB is cleared if no doc
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
            cleanupEpubInstances(); // Ensure EPUB is cleared if doc not found
          }
          return;
        }
        
        // Call cleanup for any previous EPUB *before* setting new activeDoc,
        // especially if the new doc is also an EPUB or if transitioning away from EPUB.
        if (activeDoc?.type === 'epub' || newActiveDoc.type === 'epub') {
             console.log("[ReaderPage] Active document is or was EPUB. Calling cleanupEpubInstances before processing new document.");
             cleanupEpubInstances();
        }
        
        if(isMountedRef.current) { setActiveDoc(newActiveDoc as ActiveMangaDocument); } 
        await IndexedDBService.saveLastActiveDocId(docIdToLoad!);

        if (newActiveDoc.type === 'pdf') {
            if(isMountedRef.current) setCurrentTextForTTS("Loading PDF...");
            // PDF specific loading will be handled by its dedicated useEffect based on activeDoc
        } else if (newActiveDoc.type === 'epub') {
            if(isMountedRef.current) {
                setCurrentTextForTTS("Loading EPUB...");
                setIsEpubLoading(true); // Set loading flag
                // initializeNewEpub will be called by the useEffect dependent on activeDoc & isEpubLoading
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
                if(isMountedRef.current) setIsLoadingDoc(false);
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
                if(isMountedRef.current) setIsLoadingDoc(false);
            }
        } else if (newActiveDoc.type === 'mobi') {
            if (isMountedRef.current) {
                setDocErrorMessage("MOBI files are not directly viewable. Please convert to EPUB or PDF.");
                setCurrentTextForTTS("");
                setIsLoadingDoc(false);
            }
        } else {
             if(isMountedRef.current) setIsLoadingDoc(false); 
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

    return () => {
      console.log("[ReaderPage] Main document processing useEffect UNMOUNT/CLEANUP. Calling cleanupEpubInstances.");
      cleanupEpubInstances();
      stopSpeech(true);
      if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
      if (pdfDocProxy) { try { pdfDocProxy.destroy(); } catch(e) { console.warn("Error destroying PDF proxy on main unmount", e);}}
    };
  }, [searchParams, cleanupEpubInstances, stopSpeech]); // Removed router, as redirect is handled by links
  // activeDoc is NOT a dependency here to avoid re-running cleanupEpubInstances unnecessarily when only activeDoc content changes (like OCR text)

  // PDF Loading Effect (only if activeDoc is PDF)
  useEffect(() => {
    if (activeDoc?.type === 'pdf' && activeDoc.fileData && isMountedRef.current) {
      console.log("[PDF Effect] Loading PDF document:", activeDoc.id);
      if (pdfDocProxy) { 
        try { pdfDocProxy.destroy(); } catch(e){console.warn("Error destroying previous pdfDocProxy", e);}
        setPdfDocProxy(null); // Ensure old proxy is cleared
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


  // EPUB Initialization Function (called by useEffect when activeDoc is EPUB)
  const initializeNewEpub = useCallback(async () => {
    if (!isMountedRef.current || !activeDoc || activeDoc.type !== 'epub' || !activeDoc.fileData) {
        console.warn("[EPUB Init] Aborted: Not an EPUB, no file data, or unmounted. activeDoc:", activeDoc);
        if (isMountedRef.current) { setIsLoadingDoc(false); setIsEpubLoading(false); }
        return;
    }
    console.log("[EPUB Init] Starting initialization for doc:", activeDoc.id);

    if (!epubViewerRef.current) {
        console.warn("[EPUB Init] Aborted: epubViewerRef.current is null. This should not happen with a keyed div if activeDoc is set.");
        if (isMountedRef.current) { setIsLoadingDoc(false); setIsEpubLoading(false); setDocErrorMessage("EPUB viewer element not ready."); }
        return;
    }
    
    // Ensure viewer is pristine - Keyed div helps, but this is an extra guarantee
    epubViewerRef.current.innerHTML = ''; 
    console.log("[EPUB Init] epubViewerRef.current.innerHTML cleared.");

    if (isMountedRef.current) {
        // isEpubLoading should already be true (set by main useEffect or activeDoc useEffect for EPUB)
        setIsEpubSectionDisplayed(false); 
        // setCurrentTextForTTS("Loading EPUB..."); // Already set
        // setDocErrorMessage(null); // Already set
    }

    try {
        console.log("[EPUB Init] Importing epubjs for doc:", activeDoc.id);
        const ePubModule = await import('epubjs');
        const EPub = ePubModule.default;

        const book = EPub(activeDoc.fileData);
        if (!isMountedRef.current) { try { book.destroy(); } catch (e) { console.warn("Book destroyed during init due to unmount", e); } return; }
        
        // epubBookRef.current is set *after* book.ready to ensure it's fully processed.
        // This assignment is inside the try block and before potential early returns due to unmounting.
        console.log("[EPUB Init] New Book instance created, waiting for book.ready. Doc:", activeDoc.id);
        
        await book.ready;
        if (!isMountedRef.current) {
             console.warn("[EPUB Init] Unmounted after book.ready. Aborting. Doc:", activeDoc.id); try { book.destroy(); } catch(e){ console.warn("Book (from after ready) destroyed due to unmount", e);} return;
        }
        epubBookRef.current = book; // Set the ref *after* book is ready and we are still mounted
        console.log("[EPUB Init] Book is ready. epubBookRef.current is now set. Doc:", activeDoc.id);


        if (!epubViewerRef.current || !document.body.contains(epubViewerRef.current)) {
             console.warn("[EPUB Init] Viewer detached or unavailable before rendering. Aborting. Doc:", activeDoc.id);
             if(isMountedRef.current) { setDocErrorMessage("EPUB viewer became unavailable."); setIsEpubLoading(false); setIsLoadingDoc(false); }
             return;
        }
        
        const rendition = book.renderTo(epubViewerRef.current, { width: "100%", height: "100%", flow: "paginated", spread: "auto" });
        if (!isMountedRef.current) { try { rendition.destroy(); } catch (e) { console.warn("Rendition destroyed during init due to unmount", e);} return; }
        epubRenditionRef.current = rendition;
        console.log("[EPUB Init] New Rendition instance created and ref set. Doc:", activeDoc.id);

        rendition.on('displayed', async (/* sectionResult: any */) => {
             // Check if the current rendition in the ref is the one that fired the event
            if (!isMountedRef.current || !epubRenditionRef.current || epubRenditionRef.current !== rendition || !activeDoc || activeDoc.type !== 'epub') {
                console.log("[EPUB Displayed Event] Conditions not met or stale rendition. Aborting text extraction. Current rendition in ref might be different. Doc:", activeDoc?.id); return;
            }
            console.log(`[EPUB Displayed Event] Section displayed. Rendition manager active: ${epubRenditionRef.current?.manager?.active}. Doc: ${activeDoc.id}`);
            
            try {
                const displayedContents = await rendition.getContents(); // Use the event's rendition directly
                let extractedText = "";

                if (displayedContents && displayedContents.length > 0) {
                    const sectionDocument = displayedContents[0]?.document;
                    if (sectionDocument?.body?.innerText) {
                       extractedText = sectionDocument.body.innerText.replace(/\s+/g, ' ').trim();
                    } else {
                        console.warn("[EPUB Displayed Event] sectionDocument.body.innerText not available. Doc:", activeDoc.id);
                    }
                } else {
                     console.warn("[EPUB Displayed Event] getContents() returned empty or invalid. Doc:", activeDoc.id);
                }

                if (isMountedRef.current) { // Double check mount status
                    setCurrentTextForTTS(extractedText && extractedText.length >= MIN_TTS_TEXT_LENGTH ? extractedText : "EPUB section loaded. Text may be graphical or empty.");
                    setIsEpubSectionDisplayed(true); 
                    console.log("[EPUB Displayed Event] isEpubSectionDisplayed set to true. Text length:", extractedText.length, "Doc:", activeDoc.id);
                    // Log manager active state again here to see if it changed after display
                    console.log(`[EPUB Displayed Event - After Text Extraction] Rendition manager active: ${epubRenditionRef.current?.manager?.active}.`);
                }
            } catch (textExtractError: any) {
                console.error("[EPUB Displayed Event] Error extracting text:", textExtractError, "Doc:", activeDoc.id);
                if (isMountedRef.current) { setCurrentTextForTTS(""); setDocErrorMessage(`Error extracting EPUB text: ${textExtractError.message}`); setIsEpubSectionDisplayed(true); } // still set displayed true
            }
        });
        
        rendition.on('removed', (section: any) => { console.log('[EPUB Removed Event] Section removed:', section?.id, 'for doc:', activeDoc?.id); });
        rendition.on('resized', (size: {width: number, height: number}) => { console.log('[EPUB Resized Event] New size:', size, 'for doc:', activeDoc?.id); });
        rendition.on('orientationchange', (orientation: string) => { console.log('[EPUB Orientation Change Event] New orientation:', orientation, 'for doc:', activeDoc?.id); });

        console.log("[EPUB Init] Attempting rendition.display() for doc:", activeDoc.id);
        await rendition.display(); 
        if (!isMountedRef.current || epubRenditionRef.current !== rendition) { // Check again if this is still the active rendition
            console.warn("[EPUB Init] Stale rendition instance after display or unmounted. Aborting. Doc:", activeDoc.id); return;
        }
        console.log(`[EPUB Init] rendition.display() completed. Manager Active: ${rendition.manager?.active}. For doc: ${activeDoc.id}`);

    } catch (e: any) {
        console.error("[EPUB Init] Error during EPUB initialization for doc:", activeDoc?.id, e);
        if (isMountedRef.current) {
            setDocErrorMessage(`Failed to load EPUB: ${e.message || String(e)}`);
            setCurrentTextForTTS("");
            // Ensure refs are cleared if init fails badly
            if (epubRenditionRef.current) { try { epubRenditionRef.current.destroy(); } catch(re){} epubRenditionRef.current = null;}
            if (epubBookRef.current) { try { epubBookRef.current.destroy(); } catch(be){} epubBookRef.current = null;}
        }
    } finally {
        if (isMountedRef.current) {
            setIsEpubLoading(false);
            setIsLoadingDoc(false); 
            console.log("[EPUB Init] Finally block: isEpubLoading and isLoadingDoc set to false. For doc:", activeDoc?.id);
        }
    }
  }, [activeDoc]); // Depends on activeDoc to re-run when the document changes to an EPUB

  // Effect to call initializeNewEpub when activeDoc is an EPUB and ready
  useEffect(() => {
    if (activeDoc?.type === 'epub' && activeDoc.fileData && !isLoadingDoc && isEpubLoading && isMountedRef.current) {
        console.log("[EPUB Init Trigger Effect] Conditions met to call initializeNewEpub. activeDoc.id:", activeDoc.id);
        initializeNewEpub();
    } else if (activeDoc?.type === 'epub' && isMountedRef.current && !isEpubLoading) {
        // This case handles if initializeNewEpub was somehow skipped but epub is active
        // It might be redundant if main activeDoc useEffect correctly sets isEpubLoading
        console.log("[EPUB Init Trigger Effect] activeDoc is EPUB, but isEpubLoading is false. This might indicate a state issue or prior completion.");
    }
  }, [activeDoc, isLoadingDoc, isEpubLoading, initializeNewEpub]);


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
            // Re-fetch from DB to ensure latest data before conversion for OCR
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
      if(isMountedRef.current && isPerformingOcr) setIsPerformingOcr(false); // Reset if it was set
      return;
    }

    if(!isPerformingOcr && isMountedRef.current) setIsPerformingOcr(true); // Ensure it's true if we proceed
    if(isMountedRef.current) setCurrentTextForTTS("Performing OCR...");

    try {
        const result = await performOCR(dataUrlToProcess);
        if(!isMountedRef.current) return; // Check mount status after async operation

        if ('extractedText' in result) {
            const ocrText = result.extractedText || "OCR completed, no text found.";
            setCurrentTextForTTS(ocrText);
            // Re-fetch doc from DB to ensure we're updating the latest version
            const docFromDB = await IndexedDBService.getDocumentById(currentActiveDoc.id);
            if (!docFromDB) { // Should not happen if OCR was initiated on this doc
                toast({ variant: "destructive", title: "OCR Save Error", description: "Document disappeared from DB before saving OCR text." });
                setIsPerformingOcr(false); return;
            }

            let updatedDocForSave: StoredMangaDocument = { ...docFromDB }; // Create a mutable copy
            if (updatedDocForSave.type === 'image') {
                (updatedDocForSave as StoredImageDocument).extractedText = ocrText;
            } else if (updatedDocForSave.type === 'pdf') {
                const ocrPages = { ...((updatedDocForSave as StoredPdfDocument).ocrTextPerPage || {}), [currentPdfPageNum]: ocrText };
                (updatedDocForSave as StoredPdfDocument).ocrTextPerPage = ocrPages;
                if(isMountedRef.current) setPdfPageIsTextBased(false); // Update PDF page type after OCR
            }

            await IndexedDBService.saveDocument(updatedDocForSave);
            // Update activeDoc in state only if the saved document is still the one being viewed
            if (isMountedRef.current && activeDoc && activeDoc.id === updatedDocForSave.id) {
                 setActiveDoc(updatedDocForSave as ActiveMangaDocument);
            }
            toast({ title: "OCR Successful", description: "Text extracted and saved."});

        } else { // OCR failed with an error string
            setCurrentTextForTTS(""); setDocErrorMessage(`OCR Error: ${result.error}`);
            toast({ variant: "destructive", title: "OCR Error", description: result.error });
        }
    } catch (e: any) {
      if(isMountedRef.current) { // Check mount status in catch block
        setCurrentTextForTTS(""); setDocErrorMessage(`OCR failed: ${e.message}`);
        toast({ variant: "destructive", title: "OCR Failed", description: e.message });
      }
    } finally {
      if(isMountedRef.current) setIsPerformingOcr(false); // Ensure reset in finally
    }
  }, [activeDoc, pdfPageImage, pdfPageIsTextBased, currentPdfPageNum, stopSpeech, toast]); // Added activeDoc here

  // TTS Settings and Voice List Effects
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const loadedSettings = LocalStorageService.loadTTSSettings();
      const engine = loadedSettings.engine || loadedSettings.type || 'local'; // Ensure engine is derived if missing
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
    return () => { // Cleanup
      if (typeof window !== 'undefined' && window.speechSynthesis) { window.speechSynthesis.onvoiceschanged = null; }
      stopSpeech(true); // Stop any speech on unmount
    };
  }, [populateVoiceList, stopSpeech]);

 // Effect to manage default voice selection and save settings
 useEffect(() => {
    let currentSettings = { ...ttsSettings }; // Create a mutable copy
    let settingsChanged = false;

    if (typeof window !== 'undefined' && window.speechSynthesis && currentSettings.engine === 'local') {
        // Ensure availableVoices is populated if it's empty but system has voices
        const systemVoices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService, default: v.default }));

        if (systemVoices.length > 0) {
            let voiceToSet: TTSVoice | undefined = currentSettings.voiceURI ? systemVoices.find(v => v.voiceURI === currentSettings.voiceURI) : undefined;
            let langToSet = currentSettings.language;
            // Check if the current voice (if any) is valid for the current language
            const currentVoiceIsValidForLanguage = voiceToSet && voiceToSet.lang && (voiceToSet.lang === currentSettings.language || voiceToSet.lang.startsWith(currentSettings.language.split('-')[0]));

            if (!voiceToSet || !currentVoiceIsValidForLanguage) {
                // Find a suitable default voice for the current language
                const defaultForLang = systemVoices.find(v => v.lang === currentSettings.language && v.default) ||
                                     systemVoices.find(v => v.lang === currentSettings.language) ||
                                     systemVoices.find(v => v.lang?.startsWith(currentSettings.language.split('-')[0]) && v.default) ||
                                     systemVoices.find(v => v.lang?.startsWith(currentSettings.language.split('-')[0]));

                if (defaultForLang && defaultForLang.lang) {
                    voiceToSet = defaultForLang;
                    langToSet = defaultForLang.lang; // Update language to match the chosen voice's exact lang
                } else {
                    // Fallback to any default system voice if no language-specific one is found
                    const absoluteFallback = systemVoices.find(v => v.default && v.lang) || (systemVoices.length > 0 ? systemVoices[0] : undefined);
                    if (absoluteFallback && absoluteFallback.lang) {
                        voiceToSet = absoluteFallback;
                        langToSet = absoluteFallback.lang;
                    } else {
                        // No suitable voice found
                        voiceToSet = undefined;
                    }
                }
            }
            // Update settings if changes were identified
            const newVoiceURI = voiceToSet ? voiceToSet.voiceURI : undefined;
            if (newVoiceURI !== currentSettings.voiceURI) { currentSettings.voiceURI = newVoiceURI; settingsChanged = true; }
            if (langToSet && langToSet !== currentSettings.language) { currentSettings.language = langToSet; settingsChanged = true; }

        } else { // No system voices available for local engine
            if(currentSettings.voiceURI !== undefined) { currentSettings.voiceURI = undefined; settingsChanged = true; }
        }
    } else if (currentSettings.engine === 'cloud') { // Cloud engine
        if (currentSettings.voiceURI !== undefined) { currentSettings.voiceURI = undefined; settingsChanged = true; } // Cloud doesn't use local voiceURI
    }
    
    // Compare with original ttsSettings to see if a state update is needed AND local storage save
    const needsStateUpdate = settingsChanged; // If voiceURI or language derived internally changed
    const needsLocalStorageSave = needsStateUpdate || // if internal derived changed
                                  currentSettings.rate !== ttsSettings.rate ||
                                  currentSettings.pitch !== ttsSettings.pitch ||
                                  currentSettings.engine !== ttsSettings.engine ||
                                  currentSettings.type !== ttsSettings.type; // type might track engine


    if (needsStateUpdate && isMountedRef.current) {
      setTtsSettings(currentSettings); // Update React state
    }
    if (needsLocalStorageSave) { // Save to localStorage if anything changed (user input or derived)
      LocalStorageService.saveTTSSettings(currentSettings);
    }
// Only run if user-modifiable settings change, or availableVoices (for local engine)
}, [ttsSettings.engine, ttsSettings.language, ttsSettings.rate, ttsSettings.pitch, ttsSettings.type, availableVoices, ttsSettings.voiceURI]);
// Note: ttsSettings.voiceURI is included to react to manual changes if that UI path exists, 
// but the logic prioritizes deriving it for 'local' engine.


  // Audio Player Setup for Cloud TTS
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
        setIsLoadingTTS(false); // Cloud audio has started, stop loading indicator
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

    return () => { // Cleanup
        player.removeEventListener('ended', handleAudioEnded);
        player.removeEventListener('playing', handleAudioPlaying);
        player.removeEventListener('error', handleAudioError);
        if (player.src && !player.paused) player.pause();
        player.src = ""; // Clear src
        if (audioPlayerRef.current === player) audioPlayerRef.current = null; // Nullify ref if it's this player
    };
  }, [ttsSettings.engine, isSpeaking, stopSpeech, toast]); // isSpeaking helps manage when listeners are active for cloud


  const playPauseSpeech = async () => {
    if(!isMountedRef.current) return;

    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    const selectedTextFromSelection = selection?.toString().trim();
    const effectiveTextToRead = selectedTextFromSelection || currentTextForTTS;

    // Enhanced list of invalid messages to prevent TTS playback
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

    if (isSpeaking) { // If currently speaking (or paused)
      if (isPaused) { // Resume
        if (ttsSettings.engine === 'local' && utteranceRef.current && window.speechSynthesis?.paused) {
          window.speechSynthesis.resume();
          if(isMountedRef.current) setIsPaused(false);
        } else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current?.paused) {
          audioPlayerRef.current.play().then(() => {if(isMountedRef.current) setIsPaused(false);}).catch(() => {if(isMountedRef.current) stopSpeech(true);});
        }
      } else { // Pause
        if (ttsSettings.engine === 'local' && utteranceRef.current && window.speechSynthesis?.speaking) {
          window.speechSynthesis.pause();
          if(isMountedRef.current) setIsPaused(true);
        } else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current && !audioPlayerRef.current.paused) {
          audioPlayerRef.current.pause();
          if(isMountedRef.current) setIsPaused(true);
        }
      }
    } else { // Start new speech
      stopSpeech(false); // Stop any previous speech but don't reset UI indicators yet
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
            // Fallbacks if specific voiceURI not found or not compatible with language
            if (!voiceToUse && ttsSettings.language) {
                 voiceToUse = systemVoices.find(v => v.lang === ttsSettings.language && v.default) ||
                              systemVoices.find(v => v.lang === ttsSettings.language) ||
                              systemVoices.find(v => v.lang?.startsWith(ttsSettings.language.split('-')[0]) && v.default) ||
                              systemVoices.find(v => v.lang?.startsWith(ttsSettings.language.split('-')[0]));
            }
            if (!voiceToUse) voiceToUse = systemVoices.find(v => v.default && v.lang) || (systemVoices.length > 0 ? systemVoices[0] : undefined); // Absolute fallback
        }

        if (voiceToUse) utterance.voice = voiceToUse;
        else if (availableVoices.length === 0 && systemVoices.length === 0) { // No voices at all
             toast({variant: "destructive", title: "TTS Error", description: "No speech synthesis voices available in this browser."}); stopSpeech(true); return;
        }
        // If voiceToUse is still undefined but some voices exist, browser will use its default for the lang or overall default.

        utterance.onend = () => { if(utteranceRef.current === utterance && isMountedRef.current) stopSpeech(true); };
        utterance.onerror = (event) => { if(utteranceRef.current === utterance && isMountedRef.current) { toast({ variant: "destructive", title: "TTS Error", description: event.error || "Speech failed." }); stopSpeech(true); }};

        utteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
        if(isMountedRef.current) setIsLoadingTTS(false); // Local TTS starts relatively quickly

      } else { // Cloud TTS
        try {
          const result = await getCloudSpeech(effectiveTextToRead, ttsSettings.language);
          if(!isMountedRef.current) return; // Check mount after async

          if ('audioUrl' in result && audioPlayerRef.current) {
            audioPlayerRef.current.src = result.audioUrl;
            await audioPlayerRef.current.play(); // setIsLoadingTTS(false) handled by 'playing' event
          } else if ('error' in result) {
            toast({ variant: "destructive", title: "Cloud TTS Error", description: result.error });
            if(isMountedRef.current) stopSpeech(true);
          }
        } catch (e: any) {
          if(isMountedRef.current) { // Check mount in catch
            toast({ variant: "destructive", title: "Cloud TTS Failed", description: e.message });
            stopSpeech(true);
          }
        }
      }
    }
  };

  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    if(!isMountedRef.current) return;
    stopSpeech(true); // Stop speech if settings are changed

    setTtsSettings(prevSettings => {
        let newSettings = { ...prevSettings, [key]: value };
        // If engine/type changed, ensure consistency and handle voiceURI for cloud
        if (key === 'engine') newSettings.type = value as 'local' | 'cloud';
        if (key === 'type') newSettings.engine = value as 'local' | 'cloud';
        if ((key === 'engine' || key === 'type') && newSettings.engine === 'cloud') {
            newSettings.voiceURI = undefined; // Cloud engine doesn't use local voiceURI
        }
        // Note: Actual saving to LocalStorage is handled by the dedicated useEffect for ttsSettings
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

  // PDF Navigation Handlers
  const navigatePdf = (direction: 'prev' | 'next') => {
    if (!pdfDocProxy || isRenderingPdfPage || isLoadingDoc || !isMountedRef.current) return;
    let newPage = currentPdfPageNum;
    if (direction === 'prev' && currentPdfPageNum > 1) newPage--;
    else if (direction === 'next' && currentPdfPageNum < pdfTotalPages) newPage++;
    else return; // No change
    if (newPage !== currentPdfPageNum) { stopSpeech(true); if(isMountedRef.current) setCurrentPdfPageNum(newPage); }
  };
  const handlePdfScaleChange = (newScale: number) => { if (isRenderingPdfPage || !isMountedRef.current) return; stopSpeech(true); if(isMountedRef.current) setPdfScale(newScale); };

  // EPUB Navigation Handler
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
        console.warn("[EPUB Nav] One or more pre-conditions FAILED for navigation. Values:", navConditionDetails);
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

  // Dynamic Button State for Play/Pause
  const getButtonState = () => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const effectiveText = selectedText || currentTextForTTS;
    const invalidMessages = [ "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...", "Image loaded. Perform OCR", "No text content found", "Could not extract text", "EPUB viewer element not ready", "This PDF page has no selectable text", "Performing OCR...", "No document ID provided", "Document with ID", "EPUB viewer became unavailable.", "OCR completed, but no text found.", "No document selected.", "EPUB section loaded. Text may be graphical or empty.", "Could not load EPUB section content.", "Waiting for page"];
    let canPlay = !!(effectiveText && !invalidMessages.some(msg => effectiveText.toLowerCase().startsWith(msg.toLowerCase())) && effectiveText.length >= MIN_TTS_TEXT_LENGTH && activeDoc && !isPerformingOcr && !docErrorMessage );

    // Disable play if content is actively loading/rendering for the current document type
    if (activeDoc?.type === 'pdf' && (isLoadingDoc || isRenderingPdfPage)) canPlay = false;
    else if (activeDoc?.type === 'epub' && (isLoadingDoc || isEpubLoading || !isEpubSectionDisplayed)) canPlay = false;
    else if (activeDoc?.type === 'image' && isLoadingDoc) canPlay = false;
    else if (activeDoc?.type === 'txt' && isLoadingDoc) canPlay = false;
    else if (!activeDoc) canPlay = false; // No document loaded


    if (isLoadingTTS) return { text: "Loading...", icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, disabled: true };
    if (isSpeaking && !isPaused) return { text: "Pause", icon: <Pause className="mr-1 h-4 w-4" />, disabled: false };
    if (isSpeaking && isPaused) return { text: "Resume", icon: <Play className="mr-1 h-4 w-4" />, disabled: false };
    return { text: selectedText ? "Play Selected" : "Play Text", icon: <Play className="mr-1 h-4 w-4" />, disabled: !canPlay };
  };
  const buttonState = getButtonState();

  // --- RENDER LOGIC ---
  if (isLoadingDoc && !activeDoc && !docErrorMessage && !isEpubLoading && !isRenderingPdfPage) {
    return <div className="flex items-center justify-center h-full flex-grow"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-lg">Loading document...</p></div>;
  }
  // Show general error if no activeDoc, or if activeDoc is of a type that shouldn't show its specific loader (e.g. MOBI error)
  if (docErrorMessage && (!activeDoc || (activeDoc && !['pdf', 'epub', 'txt', 'image'].includes(activeDoc.type))) ) {
    return <div className="flex flex-col items-center justify-center h-full flex-grow p-4 text-center"> <AlertTriangle className="h-12 w-12 text-destructive mb-4" /> <h2 className="text-xl font-semibold mb-2">Error Loading Document</h2> <p className="text-muted-foreground mb-4">{docErrorMessage}</p> <Button onClick={() => router.push('/library')}>Go to Library</Button> </div>;
  }

  const showOcrButtonForPdfPage = activeDoc?.type === 'pdf' && !pdfPageIsTextBased && pdfPageImage && !isRenderingPdfPage && !isLoadingDoc && !isPerformingOcr;
  const showOcrButtonForImage = activeDoc?.type === 'image' && displayedImageSrc && !isLoadingDoc && !isPerformingOcr && !(activeDoc as StoredImageDocument).extractedText;


  return (
    <div className="flex flex-col lg:flex-row w-full h-[calc(100vh-4rem)]"> {/* Full height minus header */}
      {/* Content Area */}
      <div className="flex-grow overflow-y-auto bg-muted/20 p-2 md:p-4 relative">
         {docErrorMessage && activeDoc && (activeDoc.type === 'epub' || activeDoc.type === 'pdf') && ( // Only show dismissable error for EPUB/PDF content display issues
            <div className="absolute inset-x-0 top-4 mx-auto w-fit max-w-md bg-destructive/10 border border-destructive text-destructive p-3 rounded-md shadow-lg z-10 flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div>
                    <p className="font-medium text-sm">Document Display Issue</p>
                    <p className="text-xs">{docErrorMessage}</p>
                    <Button variant="ghost" size="sm" className="text-xs h-auto p-1 mt-1 text-destructive hover:bg-destructive/20" onClick={() => {if(isMountedRef.current) setDocErrorMessage(null);}}>Dismiss</Button>
                </div>
            </div>
        )}
        {/* General loading indicator for PDF, Image, TXT if activeDoc is set but content not yet ready */}
        {isLoadingDoc && (activeDoc?.type === 'pdf' || activeDoc?.type === 'image' || activeDoc?.type === 'txt') && !docErrorMessage && !isEpubLoading &&
            <div className="flex items-center justify-center h-full"> <Loader2 className="h-10 w-10 animate-spin text-primary" /><p className="ml-3">Loading content for {activeDoc.type.toUpperCase()}...</p> </div>
        }

        {/* PDF Display */}
        {!isLoadingDoc && activeDoc?.type === 'pdf' && (
          <div className="flex flex-col items-center">
            {isRenderingPdfPage && !pdfPageImage && <Loader2 className="h-10 w-10 animate-spin my-8 text-primary" />}
            {pdfPageImage && <NextImage src={pdfPageImage} alt={`Page ${currentPdfPageNum}`} width={0} height={0} sizes="100vw" style={{ width: 'auto', height: 'auto', maxHeight: 'calc(100vh - 12rem)', maxWidth: '100%', objectFit: 'contain' }} className="shadow-lg border rounded-md" />}
            {!pdfPageImage && !isRenderingPdfPage && !docErrorMessage && (pdfDocProxy && pdfTotalPages > 0) && <div className="my-8 text-muted-foreground">{`Waiting for page ${currentPdfPageNum} to render...`}</div> }
            {showOcrButtonForPdfPage && (<Button onClick={handlePerformOcr} disabled={isPerformingOcr} className="mt-3"> {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR on PDF Page </Button> )}
          </div>
        )}

        {/* Keyed div for EPUB viewer - React unmounts/remounts this when key changes */}
        <div
            key={activeDoc?.id || 'no-epub-doc'} 
            ref={epubViewerRef}
            className={cn(
                "w-full h-full epub-viewer-container bg-background rounded-md shadow-inner", 
                // Show loader inside viewer if EPUB is loading and no section displayed yet (and no error)
                (activeDoc?.type === 'epub' && (isLoadingDoc || isEpubLoading) && !isEpubSectionDisplayed && !docErrorMessage) && "flex items-center justify-center",
                // Show error inside viewer if EPUB has error and no section displayed
                (activeDoc?.type === 'epub' && !isEpubLoading && !isEpubSectionDisplayed && docErrorMessage) && "p-4 text-center"
            )}
        >
            {/* EPUB Loader inside the keyed div */}
            {activeDoc?.type === 'epub' && (isLoadingDoc || isEpubLoading) && !isEpubSectionDisplayed && !docErrorMessage && 
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
            }
            {/* EPUB Error inside the keyed div */}
            {activeDoc?.type === 'epub' && !isEpubLoading && !isEpubSectionDisplayed && docErrorMessage &&
              <div className="text-destructive"> <AlertTriangle className="h-8 w-8 mx-auto mb-2"/> <p className="font-semibold">EPUB Load Error</p> <p className="text-sm">{docErrorMessage}</p> </div>
            }
            {/* If isEpubSectionDisplayed is true, epubjs should be rendering content here */}
        </div>

        {/* TXT Display */}
        {!isLoadingDoc && activeDoc?.type === 'txt' && (
          <pre className="whitespace-pre-wrap p-4 bg-background rounded-md shadow-inner text-sm font-mono h-full overflow-y-auto select-text">{txtContent}</pre>
        )}

        {/* Image Display */}
        {!isLoadingDoc && activeDoc?.type === 'image' && displayedImageSrc && (
            <div className="flex flex-col items-center">
                <NextImage src={displayedImageSrc} alt={activeDoc.title || 'Uploaded Image'} width={800} height={600} style={{objectFit: 'contain'}} className="max-w-full max-h-[calc(100vh-15rem)] shadow-lg border rounded-md" data-ai-hint="illustration abstract" />
                {showOcrButtonForImage && <Button onClick={handlePerformOcr} disabled={isPerformingOcr} className="mt-3"> {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR on Image </Button> }
            </div>
        )}

        {/* MOBI Not Supported Message */}
         {!isLoadingDoc && activeDoc?.type === 'mobi' && (
           <div className="p-4 bg-background rounded-md shadow-inner text-center h-full flex flex-col justify-center items-center"> <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2"/> <p className="font-semibold">MOBI File Format Not Supported</p> <p className="text-sm text-muted-foreground">Please convert to EPUB or PDF.</p> </div>
         )}

        {/* Current Text for TTS Area - shows if relevant content is loaded */}
        { (activeDoc?.type === 'pdf' || activeDoc?.type === 'epub' || activeDoc?.type === 'image' || activeDoc?.type === 'txt') && 
          currentTextForTTS && !docErrorMessage && !isLoadingDoc && !isRenderingPdfPage && !isPerformingOcr && 
          (!isEpubLoading || isEpubSectionDisplayed) && // For EPUB, ensure section is displayed or loading is done
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
                {/* General error message if not related to EPUB/PDF content rendering, or if no active doc */}
                {docErrorMessage && (!activeDoc || (activeDoc && (activeDoc.type !== 'epub' && activeDoc.type !== 'pdf'))) && <CardDescription className="text-xs text-destructive">{docErrorMessage}</CardDescription>}
            </CardHeader>
        </Card>

        {/* PDF Controls */}
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

        {/* EPUB Controls */}
        {activeDoc?.type === 'epub' && (
          <Card>
            <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">EPUB Navigation</CardTitle></CardHeader>
            <CardContent className="flex items-center justify-between pt-0">
                <Button onClick={() => navigateEpub('prev')} size="sm" variant="outline"
                  disabled={isLoadingDoc || isEpubLoading || !epubRenditionRef.current /* Simplified disabled state */}>
                  <ChevronLeft /> Previous
                </Button>
                <Button onClick={() => navigateEpub('next')} size="sm" variant="outline"
                  disabled={isLoadingDoc || isEpubLoading || !epubRenditionRef.current /* Simplified disabled state */}>
                  Next <ChevronRight />
                </Button>
            </CardContent>
          </Card>
        )}

        {/* TTS Controls */}
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
    
    
