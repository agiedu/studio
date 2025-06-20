
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
import type { TTSSettings, TTSVoice, StoredMangaDocument, ActiveMangaDocument, StoredPdfDocument, StoredImageDocument, StoredEpubDocument } from '@/types';
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
  const epubViewerRef = useRef<HTMLDivElement | null>(null);

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

  // Effect to load document metadata and perform initial cleanup for ALL document types
  useEffect(() => {
    const loadDocumentMetadata = async () => {
      console.log("[ReaderPage] loadDocumentMetadata: Initiating document metadata load.");
      
      stopSpeech(true); 
      // setActiveDoc(null); // Do NOT set activeDoc to null here, it triggers EPUB cleanup prematurely
      
      // Clear specific viewers and their states (PDF, Image, TXT)
      // EPUB viewer and refs are handled by its dedicated effect.
      if (pdfDocProxy) { try { pdfDocProxy.destroy(); } catch(e) { console.warn("Error destroying PDF proxy", e);}}
      setPdfDocProxy(null); setCurrentPdfPageNum(1); setPdfTotalPages(0); setPdfPageImage(null); setPdfPageIsTextBased(true); setIsRenderingPdfPage(false);

      if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
      setDisplayedImageSrc(null);
      setTxtContent("");
      
      setCurrentTextForTTS("");
      setDocErrorMessage(null);
      setIsLoadingDoc(true); 
      setIsPerformingOcr(false);

      let docIdToLoad = searchParams.get('docId');
      console.log(`[ReaderPage] loadDocumentMetadata: docId from searchParams: ${docIdToLoad}`);

      if (!docIdToLoad) {
        const lastActiveId = await IndexedDBService.getLastActiveDocId();
        console.log(`[ReaderPage] loadDocumentMetadata: No docId in params, lastActiveId from DB: ${lastActiveId}`);
        if (lastActiveId) {
          docIdToLoad = lastActiveId;
        } else {
          setDocErrorMessage("No document selected. Please choose one from the Library.");
          setIsLoadingDoc(false);
          setActiveDoc(null); // Explicitly nullify if no doc can be loaded
          console.log("[ReaderPage] loadDocumentMetadata: No docId to load, showing error message.");
          return;
        }
      }

      if (!docIdToLoad) { 
         setDocErrorMessage("No document selected and no previously active document found. Please go to the Library.");
         setIsLoadingDoc(false);
         setActiveDoc(null); // Explicitly nullify
         console.log("[ReaderPage] loadDocumentMetadata: Still no docId after checking last active, showing error.");
         return;
      }

      try {
        console.log(`[ReaderPage] loadDocumentMetadata: Attempting to fetch docId "${docIdToLoad}" from IndexedDB.`);
        const doc = await IndexedDBService.getDocumentById(docIdToLoad);
        if (!doc) {
          setDocErrorMessage(`Document with ID "${docIdToLoad}" not found.`);
          await IndexedDBService.saveLastActiveDocId(null); 
          setIsLoadingDoc(false);
          setActiveDoc(null); // Explicitly nullify
          console.log(`[ReaderPage] loadDocumentMetadata: Document "${docIdToLoad}" not found in DB.`);
          return;
        }

        console.log(`[ReaderPage] loadDocumentMetadata: Document "${docIdToLoad}" found. Type: ${doc.type}. Setting activeDoc.`);
        setActiveDoc(doc as ActiveMangaDocument); // This will trigger other effects (PDF, EPUB, etc.)
        await IndexedDBService.saveLastActiveDocId(docIdToLoad);
        // setIsLoadingDoc(false) will be handled by the specific document type effects

      } catch (err: any) {
        console.error("[ReaderPage] loadDocumentMetadata: Error loading document from IndexedDB:", err);
        setDocErrorMessage(`Error loading document: ${err.message}`);
        setCurrentTextForTTS(`Error loading document: ${err.message}`); 
        setIsLoadingDoc(false); 
        setActiveDoc(null); // Explicitly nullify on error
      }
    };

    loadDocumentMetadata();

    return () => {
      console.log("[ReaderPage] Main document loading useEffect UNMOUNT/CLEANUP: Stopping speech.");
      stopSpeech(true);
      if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
      if (pdfDocProxy) { try { pdfDocProxy.destroy(); } catch(e) { console.warn("Error destroying PDF proxy on main unmount", e);}}
      // EPUB cleanup is handled by its own dedicated effect.
    };
  }, [searchParams, router, stopSpeech]); 


  // Effect for PDF Loading
  useEffect(() => {
    if (activeDoc?.type === 'pdf' && activeDoc.fileData) {
      console.log("[ReaderPage PDF] activeDoc is PDF. Initializing PDF document proxy.");
      setIsLoadingDoc(true); 
      setCurrentTextForTTS("Loading PDF...");
      setDocErrorMessage(null);
      
      if (pdfDocProxy) { try { pdfDocProxy.destroy(); } catch(e){console.warn("Error destroying previous pdfDocProxy", e);}}
      setPdfDocProxy(null);

      getDocument({ data: activeDoc.fileData.slice(0) }).promise.then(pdf => {
        console.log("[ReaderPage PDF] PDF document proxy loaded. Total pages:", pdf.numPages);
        setPdfDocProxy(pdf);
        setPdfTotalPages(pdf.numPages);
        const savedPageIndex = LocalStorageService.loadCurrentPdfPageIndexForDoc(activeDoc.id);
        const pageToLoad = (savedPageIndex && savedPageIndex > 0 && savedPageIndex <= pdf.numPages) ? savedPageIndex : 1;
        setCurrentPdfPageNum(pageToLoad); 
        console.log(`[ReaderPage PDF] Setting current PDF page to: ${pageToLoad}`);
        // Page rendering will be triggered by currentPdfPageNum change
      }).catch(e => {
        console.error("[ReaderPage PDF] Error loading PDF document proxy:", e);
        setDocErrorMessage(`Failed to load PDF: ${e.message}`);
        setCurrentTextForTTS(`Failed to load PDF: ${e.message}`);
        setIsLoadingDoc(false); 
      });
    } else if (activeDoc && activeDoc.type !== 'pdf' && pdfDocProxy) {
      // Clean up PDF if activeDoc is no longer a PDF
      console.log("[ReaderPage PDF] Active document is not PDF. Cleaning up existing PDF proxy.");
      try { pdfDocProxy.destroy(); } catch(e) { console.warn("Error destroying PDF proxy on doc type change", e); }
      setPdfDocProxy(null);
      setPdfTotalPages(0);
      setPdfPageImage(null);
    }
  }, [activeDoc]); 

  // Effect for PDF Page Rendering
  useEffect(() => {
    if (activeDoc?.type === 'pdf' && pdfDocProxy && currentPdfPageNum > 0 && currentPdfPageNum <= pdfTotalPages) {
      console.log(`[ReaderPage PDF] Rendering PDF page ${currentPdfPageNum} of ${pdfTotalPages} with scale ${pdfScale}.`);
      stopSpeech(true);
      setIsRenderingPdfPage(true);
      setPdfPageImage(null); 
      setPdfPageIsTextBased(true); 
      setCurrentTextForTTS(`Loading PDF page ${currentPdfPageNum}...`);
      LocalStorageService.saveCurrentPdfPageIndexForDoc(activeDoc.id, currentPdfPageNum);

      pdfDocProxy.getPage(currentPdfPageNum).then(async (page: PDFPageProxy) => {
        console.log(`[ReaderPage PDF] Got PDF page ${currentPdfPageNum} object.`);
        const viewport = page.getViewport({ scale: pdfScale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        if (context) {
          await page.render({ canvasContext: context, viewport }).promise;
          setPdfPageImage(canvas.toDataURL('image/png'));
          console.log(`[ReaderPage PDF] Page ${currentPdfPageNum} rendered to canvas.`);
        } else {
          throw new Error("Could not get canvas context for PDF rendering.");
        }

        const pdfDocFromState = activeDoc as StoredPdfDocument; // Assume activeDoc is correctly typed
        if (pdfDocFromState.ocrTextPerPage?.[currentPdfPageNum]) {
            console.log(`[ReaderPage PDF] Page ${currentPdfPageNum} has pre-existing OCR text.`);
            setCurrentTextForTTS(pdfDocFromState.ocrTextPerPage[currentPdfPageNum]);
            setPdfPageIsTextBased(false); 
        } else {
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim();
            console.log(`[ReaderPage PDF] Page ${currentPdfPageNum} extracted text length: ${pageText.length}`);

            if (pageText && pageText.length >= MIN_PDF_TEXT_LENGTH_FOR_DIRECT_READ) {
                setCurrentTextForTTS(pageText);
                setPdfPageIsTextBased(true);
            } else {
                setCurrentTextForTTS("This PDF page has no selectable text or is image-based. Use OCR to extract text for reading.");
                setPdfPageIsTextBased(false);
            }
        }
        setIsLoadingDoc(false); 
      }).catch(e => {
        console.error(`[ReaderPage PDF] Error rendering PDF page ${currentPdfPageNum}:`, e);
        setPdfPageImage(null);
        setCurrentTextForTTS(`Error rendering PDF page ${currentPdfPageNum}: ${e.message}`);
        setPdfPageIsTextBased(false); 
        setIsLoadingDoc(false); 
      }).finally(() => {
        setIsRenderingPdfPage(false);
        console.log(`[ReaderPage PDF] Finished rendering attempt for page ${currentPdfPageNum}.`);
      });
    }
  }, [pdfDocProxy, currentPdfPageNum, pdfTotalPages, pdfScale, activeDoc, stopSpeech]);


  // Dedicated Effect for EPUB Loading, Rendering, and Cleanup
  useEffect(() => {
    let isMounted = true;
    let localBookInstance: EpubBook | null = null;
    let localRenditionInstance: Rendition | null = null;

    const initializeEpub = async () => {
      // This function is called when activeDoc is an EPUB and viewer ref is available.
      console.log("[ReaderPage EPUB] initializeEpub: Starting for doc:", activeDoc!.id);
      if (isMounted) {
        setIsLoadingDoc(true);
        setCurrentTextForTTS("Loading EPUB...");
        setDocErrorMessage(null);
      }

      // Thoroughly clean up any existing global EPUB instances *before* new init
      if (epubRenditionRef.current) {
        console.log("[ReaderPage EPUB] initializeEpub: Global rendition exists. Attempting safe destroy.");
        try {
          if (epubViewerRef.current && epubRenditionRef.current.manager?.container?.parentNode === epubViewerRef.current) {
            epubRenditionRef.current.destroy();
            console.log("[ReaderPage EPUB] initializeEpub: Destroyed existing global rendition.");
          } else {
            console.warn("[ReaderPage EPUB] initializeEpub: Existing global rendition's container invalid. Skipping destroy.");
          }
        } catch (e) { console.warn("[ReaderPage EPUB] initializeEpub: Error destroying existing global rendition:", e); }
      }
      if (epubBookRef.current) {
        try { epubBookRef.current.destroy(); console.log("[ReaderPage EPUB] initializeEpub: Destroyed existing global book."); }
        catch (e) { console.warn("[ReaderPage EPUB] initializeEpub: Error destroying existing global book:", e); }
      }
      if (epubViewerRef.current) epubViewerRef.current.innerHTML = ''; // Critical: Clear the div
      epubRenditionRef.current = null;
      epubBookRef.current = null;

      try {
        const ePubModule = await import('epubjs');
        const EPub = ePubModule.default;

        localBookInstance = EPub(activeDoc!.fileData);
        console.log("[ReaderPage EPUB] initializeEpub: Local EpubBook instance created.");

        await localBookInstance.ready;
        if (!isMounted) {
          console.warn("[ReaderPage EPUB] initializeEpub: Unmounted during book.ready. Aborting.");
          localBookInstance?.destroy(); return;
        }
        console.log("[ReaderPage EPUB] initializeEpub: Local book ready.");

        if (!epubViewerRef.current) { // Re-check, critical for async flow
            console.error("[ReaderPage EPUB] initializeEpub: epubViewerRef.current became null after book.ready. Cannot render.");
            if (isMounted) setDocErrorMessage("EPUB viewer became unavailable.");
            localBookInstance?.destroy(); return;
        }

        localRenditionInstance = localBookInstance.renderTo(epubViewerRef.current, {
          width: "100%", height: "100%", flow: "paginated", spread: "none",
        });
        console.log("[ReaderPage EPUB] initializeEpub: Local Rendition instance created, ID:", localRenditionInstance.id);

        localRenditionInstance.on('displayed', (section: any) => {
          if (!isMounted || !localRenditionInstance || epubRenditionRef.current?.id !== localRenditionInstance?.id) {
            console.log("[ReaderPage EPUB] 'displayed' event: Conditions not met (unmounted or instance mismatch). Ignoring.");
            return;
          }
          console.log("[ReaderPage EPUB] Rendition 'displayed' event for section:", section.idref);
          try {
            const contents = section.contents || (section.document ? section.document.body : null);
            let text = contents ? (contents.innerText || contents.textContent || "").replace(/\s+/g, ' ').trim() : "";
            if (!text && section.output) { const d = document.createElement('div'); d.innerHTML = section.output; text = (d.innerText || d.textContent || "").replace(/\s+/g, ' ').trim(); }
            if (isMounted) setCurrentTextForTTS(text || "EPUB section loaded. Text may be graphical or empty.");
          } catch (textExtractError: any) {
            console.error("[ReaderPage EPUB] Error extracting text from EPUB section:", textExtractError);
            if (isMounted) setCurrentTextForTTS(`Error extracting EPUB text: ${textExtractError.message}`);
          }
        });

        await localRenditionInstance.display();
        if (!isMounted) {
          console.warn("[ReaderPage EPUB] initializeEpub: Unmounted during rendition.display. Aborting.");
          localRenditionInstance?.destroy(); localBookInstance?.destroy(); return;
        }
        
        epubBookRef.current = localBookInstance; // Assign to global ref only after success
        epubRenditionRef.current = localRenditionInstance;
        console.log("[ReaderPage EPUB] initializeEpub: Rendition displayed. Global refs updated.");

      } catch (e: any) {
        console.error("[ReaderPage EPUB] initializeEpub: Error during EPUB initialization:", e);
        if (isMounted) {
          setDocErrorMessage(`Failed to load EPUB: ${e.message || String(e)}`);
          setCurrentTextForTTS(`Failed to load EPUB: ${e.message || String(e)}`);
        }
        localRenditionInstance?.destroy();
        localBookInstance?.destroy();
        epubBookRef.current = null;
        epubRenditionRef.current = null;
        if (epubViewerRef.current && isMounted) epubViewerRef.current.innerHTML = '';
      } finally {
        if (isMounted) setIsLoadingDoc(false);
        console.log("[ReaderPage EPUB] initializeEpub: Finished attempt for doc:", activeDoc?.id);
      }
    };

    if (activeDoc && activeDoc.type === 'epub' && activeDoc.fileData) {
      if (epubViewerRef.current) {
        initializeEpub();
      } else {
        console.warn("[ReaderPage EPUB Effect] epubViewerRef.current is null. Waiting for it to be rendered.");
        if (isMounted) {
            // Set a message indicating viewer is preparing, isLoadingDoc should already be true from main effect
            setDocErrorMessage("EPUB viewer element is preparing...");
            setCurrentTextForTTS(""); // Clear any stale text
        }
      }
    } else {
      // Not an EPUB, or no activeDoc. Clean up any existing EPUB.
      console.log("[ReaderPage EPUB Effect] Not an EPUB or no activeDoc. Entering cleanup phase.");
      const currentRendition = epubRenditionRef.current; // Capture before nullifying
      const currentBook = epubBookRef.current;

      if (currentRendition) {
        console.log("[ReaderPage EPUB Effect] Attempting to destroy existing rendition (ID:", currentRendition.id, ") during non-EPUB cleanup.");
        try {
          if (epubViewerRef.current && currentRendition.manager?.container?.parentNode === epubViewerRef.current) {
            currentRendition.destroy();
            console.log("[ReaderPage EPUB Effect] Destroyed rendition successfully (non-EPUB cleanup).");
          } else {
            console.warn("[ReaderPage EPUB Effect] Rendition's container invalid or viewer gone during non-EPUB cleanup. Skipping destroy.");
          }
        } catch (e) { console.warn("[ReaderPage EPUB Effect] Error destroying rendition (non-EPUB cleanup):", e); }
      }
      if (currentBook) {
        try { currentBook.destroy(); console.log("[ReaderPage EPUB Effect] Destroyed book successfully (non-EPUB cleanup).");}
        catch (e) { console.warn("[ReaderPage EPUB Effect] Error destroying book (non-EPUB cleanup):", e); }
      }
      if (epubViewerRef.current) { // If the div itself still exists, clear it
          epubViewerRef.current.innerHTML = '';
          console.log("[ReaderPage EPUB Effect] Cleared epubViewerRef.current.innerHTML (non-EPUB cleanup).");
      }
      epubRenditionRef.current = null;
      epubBookRef.current = null;

      if (isMounted && activeDoc && !['pdf', 'epub', 'image', 'txt'].includes(activeDoc.type) && isLoadingDoc) {
          setIsLoadingDoc(false); // Ensure loading is false if it was an unhandled type
      }
    }

    return () => {
      isMounted = false;
      console.log(`[ReaderPage EPUB Effect Cleanup] Unmounting or activeDoc changed. Current localRenditionInstance ID: ${localRenditionInstance?.id}, Global Rendition ID: ${epubRenditionRef.current?.id}`);
      
      const renditionToDestroy = localRenditionInstance || epubRenditionRef.current;
      const bookToDestroy = localBookInstance || epubBookRef.current;

      if (renditionToDestroy) {
        console.log(`[ReaderPage EPUB Effect Cleanup] Attempting to destroy rendition (ID: ${renditionToDestroy.id})`);
        try {
          if (epubViewerRef.current && renditionToDestroy.manager?.container?.parentNode === epubViewerRef.current) {
            renditionToDestroy.destroy();
            console.log(`[ReaderPage EPUB Effect Cleanup] Destroyed rendition (ID: ${renditionToDestroy.id}) successfully.`);
          } else {
            console.warn(`[ReaderPage EPUB Effect Cleanup] Rendition's (ID: ${renditionToDestroy.id}) container invalid or viewer gone. Skipping destroy.`);
          }
        } catch (e) { console.warn(`[ReaderPage EPUB Effect Cleanup] Error destroying rendition (ID: ${renditionToDestroy.id}):`, e); }
      }

      if (bookToDestroy) {
         try { bookToDestroy.destroy(); console.log(`[ReaderPage EPUB Effect Cleanup] Destroyed book successfully.`); }
         catch (e) { console.warn(`[ReaderPage EPUB Effect Cleanup] Error destroying book:`, e); }
      }
      
      epubRenditionRef.current = null; // Always nullify on cleanup
      epubBookRef.current = null;

      if (epubViewerRef.current) { // If viewer div exists, ensure it's empty
        epubViewerRef.current.innerHTML = '';
        console.log("[ReaderPage EPUB Effect Cleanup] Cleared epubViewerRef.current.innerHTML.");
      }
      console.log("[ReaderPage EPUB Effect Cleanup] Finished.");
    };
  }, [activeDoc]);


  // Effect for TXT file loading
  useEffect(() => {
    if (activeDoc?.type === 'txt' && activeDoc.fileData) {
        console.log("[ReaderPage TXT] activeDoc is TXT. Decoding file data.");
        setIsLoadingDoc(true);
        setCurrentTextForTTS("Loading text file...");
        setDocErrorMessage(null);
        try {
            const decoder = new TextDecoder(); 
            const text = decoder.decode(activeDoc.fileData);
            setTxtContent(text);
            setCurrentTextForTTS(text);
            console.log(`[ReaderPage TXT] Decoded text length: ${text.length}`);
        } catch (e: any) {
            console.error("[ReaderPage TXT] Error decoding TXT file:", e);
            setDocErrorMessage(`Failed to decode TXT file: ${e.message}`);
            setCurrentTextForTTS(`Failed to decode TXT file: ${e.message}`);
        } finally {
            setIsLoadingDoc(false);
        }
    } else if (!activeDoc || activeDoc.type !== 'txt') {
      setTxtContent(""); 
      // if (isLoadingDoc && activeDoc && !['pdf', 'epub', 'image'].includes(activeDoc.type)) {
      //     setIsLoadingDoc(false); 
      // }
    }
  }, [activeDoc]);

  // Effect for Image file loading
  useEffect(() => {
    if (activeDoc?.type === 'image' && activeDoc.fileData) {
        console.log("[ReaderPage Image] activeDoc is Image. Creating object URL.");
        setIsLoadingDoc(true);
        setCurrentTextForTTS("Loading image...");
        setDocErrorMessage(null);
        try {
            const blob = new Blob([activeDoc.fileData], { type: activeDoc.originalType });
            if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); }
            
            const newUrl = URL.createObjectURL(blob);
            currentImageObjectUrlRef.current = newUrl;
            setDisplayedImageSrc(newUrl);
            console.log(`[ReaderPage Image] Created object URL: ${newUrl}`);

            const imageDoc = activeDoc as StoredImageDocument;
            if (imageDoc.extractedText) {
                setCurrentTextForTTS(imageDoc.extractedText);
                console.log("[ReaderPage Image] Image has pre-existing extracted text.");
            } else {
                setCurrentTextForTTS("Image loaded. Perform OCR to extract text for reading aloud.");
            }
        } catch (e: any) {
            console.error("[ReaderPage Image] Error creating object URL for image:", e);
            setDocErrorMessage(`Failed to load image: ${e.message}`);
            setCurrentTextForTTS(`Failed to load image: ${e.message}`);
        } finally {
            setIsLoadingDoc(false);
        }
    } else if (!activeDoc || activeDoc.type !== 'image') {
        if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
        setDisplayedImageSrc(null);
        // if (isLoadingDoc && activeDoc && !['pdf', 'epub', 'txt'].includes(activeDoc.type)) {
        //     setIsLoadingDoc(false); 
        // }
    }
  }, [activeDoc]);


  const handlePerformOcr = useCallback(async () => {
    if (!activeDoc) {
        toast({ variant: "destructive", title: "OCR Error", description: "No active document to perform OCR on." });
        return;
    }
    console.log(`[ReaderPage OCR] Initiating OCR for doc type: ${activeDoc.type}`);

    stopSpeech(true);
    let dataUrlToProcess: string | null = null;
    const currentActiveDoc = activeDoc; 

    if (currentActiveDoc.type === 'pdf' && pdfPageImage && !pdfPageIsTextBased) {
        dataUrlToProcess = pdfPageImage;
        console.log("[ReaderPage OCR] Using current PDF page image for OCR.");
    } else if (currentActiveDoc.type === 'image' && currentActiveDoc.fileData) {
        console.log("[ReaderPage OCR] Preparing image document for OCR from ArrayBuffer.");
        try {
            const docToProcess = await IndexedDBService.getDocumentById(currentActiveDoc.id);
            if (!docToProcess || !docToProcess.fileData || !docToProcess.originalType) {
                toast({variant: "destructive", title: "OCR Error", description: "Image data or type is missing for OCR."});
                setIsPerformingOcr(false); 
                console.error("[ReaderPage OCR] Image data or type missing from fetched doc for OCR.");
                return;
            }
            dataUrlToProcess = await IndexedDBService.arrayBufferToBase64DataURL(docToProcess.fileData, docToProcess.originalType);
            console.log("[ReaderPage OCR] Image converted to Base64 data URL for OCR.");
        } catch (conversionError: any) {
          toast({variant: "destructive", title: "OCR Error", description: `Could not prepare image data for OCR: ${conversionError.message}`});
          console.error("[ReaderPage OCR] Error converting image ArrayBuffer to Base64 for OCR:", conversionError);
          setIsPerformingOcr(false); 
          return;
        }
    }

    if (!dataUrlToProcess) {
        toast({ variant: "destructive", title: "OCR Error", description: "No image data available for OCR for the current document type or state." });
        setIsPerformingOcr(false); 
        console.warn("[ReaderPage OCR] No dataUrlToProcess for OCR. ActiveDoc type:", currentActiveDoc.type, "PDF Page Image exists:", !!pdfPageImage, "PDF Page is text based:", pdfPageIsTextBased);
        return;
    }

    setIsPerformingOcr(true);
    setCurrentTextForTTS("Performing OCR...");

    try {
        const result = await performOCR(dataUrlToProcess);
        if ('extractedText' in result) {
            const ocrText = result.extractedText || "OCR completed, but no text found.";
            setCurrentTextForTTS(ocrText);
            console.log(`[ReaderPage OCR] OCR successful. Extracted text length: ${ocrText.length}`);

            const updatedDocFields: Partial<ActiveMangaDocument> = {};
            if (currentActiveDoc.type === 'image') {
                (updatedDocFields as Partial<StoredImageDocument>).extractedText = ocrText;
            } else if (currentActiveDoc.type === 'pdf') {
                const existingOcrTextPerPage = (currentActiveDoc as StoredPdfDocument).ocrTextPerPage || {};
                const ocrPages = { ...existingOcrTextPerPage, [currentPdfPageNum]: ocrText };
                (updatedDocFields as Partial<StoredPdfDocument>).ocrTextPerPage = ocrPages;
                 setPdfPageIsTextBased(false); 
            }

            const newActiveDocState = { ...currentActiveDoc, ...updatedDocFields } as ActiveMangaDocument;
            await IndexedDBService.saveDocument(newActiveDocState);
            setActiveDoc(newActiveDocState); 
            console.log("[ReaderPage OCR] Updated document saved to IndexedDB and activeDoc state updated.");

        } else {
            setCurrentTextForTTS(`OCR Error: ${result.error}`);
            toast({ variant: "destructive", title: "OCR Error", description: result.error });
            console.error(`[ReaderPage OCR] OCR action returned error: ${result.error}`);
        }
    } catch (e: any) {
        console.error("[ReaderPage OCR] Detailed OCR error from server action call:", e);
        setCurrentTextForTTS(`OCR failed: ${e.message}`);
        toast({ variant: "destructive", title: "OCR Failed", description: e.message });
    } finally {
        setIsPerformingOcr(false);
        console.log("[ReaderPage OCR] Finished OCR attempt.");
    }
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
      console.log("[ReaderPage TTS] Populated voice list. Count:", voices.length);
    }
  }, []);

  useEffect(() => {
    populateVoiceList(); 
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = populateVoiceList;
      console.log("[ReaderPage TTS] Attached onvoiceschanged listener.");
    }
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.onvoiceschanged = null;
          console.log("[ReaderPage TTS] Detached onvoiceschanged listener.");
      }
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

            const currentVoiceIsValidForLanguage = voiceToSet && voiceToSet.lang && 
                                                   (voiceToSet.lang === settingsToSave.language || voiceToSet.lang.startsWith(settingsToSave.language.split('-')[0]));

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
            if (newVoiceURI !== settingsToSave.voiceURI) {
                settingsToSave.voiceURI = newVoiceURI;
                changesMadeToSettingsState = true;
                console.log("[ReaderPage TTS] Updated voiceURI to:", newVoiceURI);
            }
            if (langToSet && langToSet !== settingsToSave.language) {
                settingsToSave.language = langToSet;
                changesMadeToSettingsState = true;
                console.log("[ReaderPage TTS] Updated language to:", langToSet, "based on voice selection.");
            }
        } else { 
             if(settingsToSave.voiceURI !== undefined) { 
                settingsToSave.voiceURI = undefined;
                changesMadeToSettingsState = true;
                console.log("[ReaderPage TTS] No system voices. Cleared voiceURI.");
             }
        }
    } else if (settingsToSave.engine === 'cloud') {
        if (settingsToSave.voiceURI !== undefined) {
            settingsToSave.voiceURI = undefined;
            changesMadeToSettingsState = true;
            console.log("[ReaderPage TTS] Engine set to cloud. Cleared voiceURI.");
        }
    }

    if (changesMadeToSettingsState || 
        settingsToSave.rate !== ttsSettings.rate ||
        settingsToSave.pitch !== ttsSettings.pitch
        ) {
      if(changesMadeToSettingsState) { 
        setTtsSettings(settingsToSave);
      }
      LocalStorageService.saveTTSSettings(settingsToSave); 
      console.log("[ReaderPage TTS] Saved TTS settings to localStorage:", settingsToSave);
    }
}, [ttsSettings.engine, ttsSettings.language, ttsSettings.voiceURI, availableVoices, ttsSettings.rate, ttsSettings.pitch, ttsSettings]);


  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player; 

    const handleAudioEnded = () => { 
      if (audioPlayerRef.current === player && isSpeaking && ttsSettings.engine === 'cloud') {
        console.log("[ReaderPage CloudTTS] Audio ended.");
        stopSpeech(true); 
      }
    };
    const handleAudioPlaying = () => { 
      if (audioPlayerRef.current === player && ttsSettings.engine === 'cloud' && isSpeaking) {
        console.log("[ReaderPage CloudTTS] Audio playing.");
        setIsLoadingTTS(false); 
      }
    };
    const handleAudioError = (e: Event) => { 
      if (audioPlayerRef.current === player && isSpeaking && ttsSettings.engine === 'cloud') {
        toast({variant: "destructive", title: "Audio Error", description: "Failed to play cloud TTS audio."}); 
        console.error("[ReaderPage CloudTTS] Audio player error:", e); 
        stopSpeech(true); 
      }
    };

    player.addEventListener('ended', handleAudioEnded);
    player.addEventListener('playing', handleAudioPlaying);
    player.addEventListener('error', handleAudioError);

    return () => {
        console.log("[ReaderPage CloudTTS] Cleaning up audio player effect.");
        player.removeEventListener('ended', handleAudioEnded);
        player.removeEventListener('playing', handleAudioPlaying);
        player.removeEventListener('error', handleAudioError);
        if (player.src && !player.paused) {
          console.log("[ReaderPage CloudTTS] Pausing player on cleanup.");
          player.pause();
        }
        player.src = ""; 
        if (audioPlayerRef.current === player) { 
          audioPlayerRef.current = null;
          console.log("[ReaderPage CloudTTS] audioPlayerRef.current set to null.");
        }
    };
  }, [ttsSettings.engine, isSpeaking, stopSpeech, toast]); 

  const playPauseSpeech = async () => {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    const selectedTextFromSelection = selection?.toString().trim();
    const effectiveTextToRead = selectedTextFromSelection || currentTextForTTS;

    console.log("[ReaderPage TTS] playPauseSpeech called. isSpeaking:", isSpeaking, "isPaused:", isPaused, "Selected text length:", selectedTextFromSelection?.length, "Current TTS text length:", currentTextForTTS.length);

    const invalidMessages = [
      "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...",
      "Image loaded. Perform OCR", "No text content found", "Could not extract text",
      "EPUB viewer element not ready. Waiting for render.", "EPUB section loaded, but text extraction",
      "This PDF page has no selectable text", "MOBI files cannot be read directly.",
      "This PDF page seems to be an image. Use OCR to extract text.",
      "Performing OCR...", "No document ID provided", "Document with ID",
       "EPUB viewer element is not available in the DOM yet", "EPUB viewer element not yet available. Waiting for render.",
       "EPUB viewer element not ready. Waiting for render.", 
      "EPUB viewer element not ready", "MOBI file format is not directly supported",
      "OCR completed, but no text found.",
      "No document selected.", "No document selected and no previously active document found.",
      "EPUB viewer initializing...", "EPUB viewer element is preparing...", "EPUB section loaded. Text may be graphical or empty."
    ];

    if (!effectiveTextToRead || invalidMessages.some(msg => effectiveTextToRead.startsWith(msg)) || effectiveTextToRead.length < MIN_TTS_TEXT_LENGTH) {
      toast({ variant: "destructive", title: "No Valid Text", description: `No valid text to read, text is a placeholder, or text is too short (min ${MIN_TTS_TEXT_LENGTH} chars). Current text: "${effectiveTextToRead.substring(0,50)}..."` });
      console.warn("[ReaderPage TTS] No valid text to read. Effective text:", effectiveTextToRead.substring(0,100));
      return;
    }

    if (isSpeaking) {
      if (isPaused) { 
        console.log("[ReaderPage TTS] Resuming speech. Engine:", ttsSettings.engine);
        if (ttsSettings.engine === 'local' && utteranceRef.current && window.speechSynthesis?.paused) { window.speechSynthesis.resume(); setIsPaused(false); }
        else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current?.paused) { 
            audioPlayerRef.current.play().then(() => setIsPaused(false)).catch((e) => { console.error("Error resuming cloud TTS:", e); stopSpeech(true); });
        } else {
            console.warn("[ReaderPage TTS] Resume called but conditions not met. Utterance:", !!utteranceRef.current, "Synth Paused:", window.speechSynthesis?.paused, "Audio Paused:", audioPlayerRef.current?.paused);
        }
      } else { 
        console.log("[ReaderPage TTS] Pausing speech. Engine:", ttsSettings.engine);
        if (ttsSettings.engine === 'local' && utteranceRef.current && window.speechSynthesis?.speaking) { window.speechSynthesis.pause(); setIsPaused(true); }
        else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current && !audioPlayerRef.current.paused) { audioPlayerRef.current.pause(); setIsPaused(true); }
        else {
            console.warn("[ReaderPage TTS] Pause called but conditions not met. Utterance:", !!utteranceRef.current, "Synth Speaking:", window.speechSynthesis?.speaking, "Audio Playing:", !audioPlayerRef.current?.paused);
        }
      }
    } else { 
      stopSpeech(false); 
      setIsLoadingTTS(true);
      setIsSpeaking(true);
      setIsPaused(false);
      console.log("[ReaderPage TTS] Starting speech. Engine:", ttsSettings.engine, "Text length:", effectiveTextToRead.length);

      if (ttsSettings.engine === 'local') {
        if (typeof window === 'undefined' || !window.speechSynthesis) { toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." }); stopSpeech(true); return; }

        const utterance = new SpeechSynthesisUtterance(effectiveTextToRead);
        utterance.lang = ttsSettings.language; utterance.pitch = ttsSettings.pitch; utterance.rate = ttsSettings.rate;

        const systemVoices = window.speechSynthesis.getVoices();
        let voiceToUse: SpeechSynthesisVoice | undefined = undefined;

        if (systemVoices.length > 0) {
            if (ttsSettings.voiceURI) { 
                voiceToUse = systemVoices.find(v => v.voiceURI === ttsSettings.voiceURI && v.lang.startsWith(ttsSettings.language.split('-')[0]));
            }
            if (!voiceToUse && ttsSettings.language) { 
                voiceToUse = systemVoices.find(v => v.lang === ttsSettings.language && v.default) ||
                             systemVoices.find(v => v.lang === ttsSettings.language) ||
                             systemVoices.find(v => v.lang?.startsWith(ttsSettings.language.split('-')[0]) && v.default) ||
                             systemVoices.find(v => v.lang?.startsWith(ttsSettings.language.split('-')[0]));
            }
            if (!voiceToUse) { 
                voiceToUse = systemVoices.find(v => v.default && v.lang) || (systemVoices.length > 0 ? systemVoices[0] : undefined);
            }
        }
        
        if (voiceToUse) {
          utterance.voice = voiceToUse;
          console.log("[ReaderPage TTS] Using local voice:", voiceToUse.name, voiceToUse.lang);
        } else if (availableVoices.length === 0 && systemVoices.length === 0) {
          toast({variant: "destructive", title: "TTS Error", description: "No speech synthesis voices available in this browser."}); stopSpeech(true); return;
        } else {
          console.warn("[ReaderPage TTS] No specific voice found, using browser default for lang:", ttsSettings.language);
        }

        utterance.onend = () => { console.log("[ReaderPage TTS] Local speech ended."); if(utteranceRef.current === utterance) stopSpeech(true); };
        utterance.onerror = (event) => { console.error("[ReaderPage TTS] Local speech error:", event.error); if(utteranceRef.current === utterance) { toast({ variant: "destructive", title: "TTS Error", description: event.error || "Speech failed." }); stopSpeech(true); }};
        utteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
        setIsLoadingTTS(false); 
      } else { 
        console.log("[ReaderPage TTS] Requesting Cloud TTS.");
        try {
          const result = await getCloudSpeech(effectiveTextToRead, ttsSettings.language);
          if ('audioUrl' in result && audioPlayerRef.current) {
            console.log("[ReaderPage TTS] Cloud TTS audio URL received:", result.audioUrl);
            audioPlayerRef.current.src = result.audioUrl;
            await audioPlayerRef.current.play();
          }
          else if ('error' in result) { 
            toast({ variant: "destructive", title: "Cloud TTS Error", description: result.error }); 
            console.error("[ReaderPage TTS] Cloud TTS returned error:", result.error);
            stopSpeech(true); 
          }
        } catch (e: any) { 
          toast({ variant: "destructive", title: "Cloud TTS Failed", description: e.message }); 
          console.error("[ReaderPage TTS] Error calling getCloudSpeech:", e);
          stopSpeech(true); 
        }
      }
    }
  };

  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    console.log(`[ReaderPage TTS] handleSettingChange: key=${key}, value=${value}`);
    stopSpeech(true); 

    setTtsSettings(prevSettings => {
        let newSettings = { ...prevSettings, [key]: value };

        if (key === 'engine') {
            newSettings.type = value as 'local' | 'cloud'; 
        }
        if (key === 'type') {
            newSettings.engine = value as 'local' | 'cloud'; 
        }

        if ((key === 'engine' || key === 'type') && newSettings.engine === 'cloud') {
            newSettings.voiceURI = undefined;
        }
        return newSettings;
    });
  };


  const handleFavoriteSelection = () => {
    const selection = window.getSelection()?.toString().trim() || currentTextForTTS;
    console.log("[ReaderPage Fav] handleFavoriteSelection. Current text for TTS length:", currentTextForTTS.length, "Selection length:", window.getSelection()?.toString().trim()?.length);
    
    const invalidMessages = [
      "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...",
      "Image loaded. Perform OCR", "No text content found", "Could not extract text",
      "EPUB viewer element not ready. Waiting for render.", "EPUB section loaded, but text extraction",
      "This PDF page has no selectable text", "MOBI files cannot be read directly.",
      "This PDF page seems to be an image. Use OCR to extract text.",
      "Performing OCR...", "No document ID provided", "Document with ID",
       "EPUB viewer element is not available in the DOM yet", "EPUB viewer element not yet available. Waiting for render.",
       "EPUB viewer element not ready. Waiting for render.", 
      "EPUB viewer element not ready", "MOBI file format is not directly supported",
      "OCR completed, but no text found.",
      "No document selected.", "No document selected and no previously active document found.",
      "EPUB viewer initializing...", "EPUB viewer element is preparing...", "EPUB section loaded. Text may be graphical or empty."
    ];

    if (selection && activeDoc && !invalidMessages.some(msg => selection.startsWith(msg)) && selection.length >= MIN_TTS_TEXT_LENGTH) {
      LocalStorageService.addFavoriteItem({ id: Date.now().toString(), text: selection, sourceDocumentId: activeDoc.id, sourceDocumentName: activeDoc.title, createdAt: Date.now() });
      toast({ title: "Favorited!", description: `"${selection.substring(0,50)}..." added.`});
      console.log("[ReaderPage Fav] Favorited text:", selection.substring(0,50));
    } else {
      toast({ variant: "destructive", title: "No Valid Text", description: `Ensure valid text (min ${MIN_TTS_TEXT_LENGTH} chars) is available or selected to favorite. Text was: "${selection.substring(0,50)}..."` });
      console.warn("[ReaderPage Fav] No valid text to favorite. Selection:", selection.substring(0,100));
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
    if (isRenderingPdfPage) return;
    stopSpeech(true); 
    setPdfScale(newScale);
  };

  const navigateEpub = (direction: 'prev' | 'next') => {
    if (!epubRenditionRef.current || isLoadingDoc || !epubViewerRef.current || !epubRenditionRef.current.manager?.active ) return; 
    stopSpeech(true); 
    if (direction === 'prev') epubRenditionRef.current.prev(); else epubRenditionRef.current.next();
  };

  const getButtonState = () => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const effectiveText = selectedText || currentTextForTTS;
    const invalidMessages = [ 
      "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...",
      "Image loaded. Perform OCR", "No text content found", "Could not extract text",
      "EPUB viewer element not ready. Waiting for render.", "EPUB section loaded, but text extraction",
      "This PDF page has no selectable text", "MOBI files cannot be read directly.",
      "This PDF page seems to be an image. Use OCR to extract text.",
      "Performing OCR...", "No document ID provided", "Document with ID",
       "EPUB viewer element is not available in the DOM yet", "EPUB viewer element not yet available. Waiting for render.",
       "EPUB viewer element not ready. Waiting for render.", 
      "EPUB viewer element not ready", "MOBI file format is not directly supported",
      "OCR completed, but no text found.",
      "No document selected.", "No document selected and no previously active document found.",
      "EPUB viewer initializing...", "EPUB viewer element is preparing...", "EPUB section loaded. Text may be graphical or empty."
    ];
    const canPlay = !!(effectiveText && !invalidMessages.some(msg => effectiveText.startsWith(msg)) && effectiveText.length >= MIN_TTS_TEXT_LENGTH && activeDoc && !isLoadingDoc && !isPerformingOcr && !isRenderingPdfPage && !docErrorMessage);

    if (isLoadingTTS) return { text: "Loading...", icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, disabled: true };
    if (isSpeaking && !isPaused) return { text: "Pause", icon: <Pause className="mr-1 h-4 w-4" />, disabled: false };
    if (isSpeaking && isPaused) return { text: "Resume", icon: <Play className="mr-1 h-4 w-4" />, disabled: false };
    return { text: selectedText ? "Play Selected" : "Play Text", icon: <Play className="mr-1 h-4 w-4" />, disabled: !canPlay };
  };
  const buttonState = getButtonState();

  if (isLoadingDoc && !activeDoc && !docErrorMessage) {
    return <div className="flex items-center justify-center h-full flex-grow"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-lg">Loading document...</p></div>;
  }

  if (docErrorMessage && (!activeDoc || (activeDoc && !['pdf', 'epub', 'txt', 'image'].includes(activeDoc.type))) ) {
    return <div className="flex flex-col items-center justify-center h-full flex-grow p-4 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-xl font-semibold mb-2">Error Loading Document</h2>
        <p className="text-muted-foreground mb-4">{docErrorMessage}</p>
        <Button onClick={() => router.push('/library')}>Go to Library</Button>
    </div>;
  }
  
  const showOcrButtonForPdfPage = activeDoc?.type === 'pdf' && !pdfPageIsTextBased && pdfPageImage && !isRenderingPdfPage && !isLoadingDoc && !isPerformingOcr;
  const showOcrButtonForImage = activeDoc?.type === 'image' && displayedImageSrc && !isLoadingDoc && !isPerformingOcr && !(activeDoc as StoredImageDocument).extractedText;


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

        {isLoadingDoc && (activeDoc?.type === 'pdf' || activeDoc?.type === 'epub' || activeDoc?.type === 'image' || activeDoc?.type === 'txt') && !docErrorMessage &&
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-10 w-10 animate-spin text-primary" /><p className="ml-3">Loading content for {activeDoc.type.toUpperCase()}...</p>
            </div>
        }

        {!isLoadingDoc && activeDoc?.type === 'pdf' && (
          <div className="flex flex-col items-center">
            {isRenderingPdfPage && !pdfPageImage && <Loader2 className="h-10 w-10 animate-spin my-8 text-primary" />}
            {pdfPageImage && <NextImage src={pdfPageImage} alt={`Page ${currentPdfPageNum}`} width={0} height={0} sizes="100vw" style={{ width: 'auto', height: 'auto', maxHeight: 'calc(100vh - 12rem)', maxWidth: '100%', objectFit: 'contain' }} className="shadow-lg border rounded-md" />}
            {!pdfPageImage && !isRenderingPdfPage && !docErrorMessage && (pdfDocProxy && pdfTotalPages > 0) && 
                <div className="my-8 text-muted-foreground">{`Waiting for page ${currentPdfPageNum} to render...`}</div>
            }
             {showOcrButtonForPdfPage && (
                <Button onClick={handlePerformOcr} disabled={isPerformingOcr} className="mt-3">
                    {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR on PDF Page
                </Button>
            )}
          </div>
        )}

        {activeDoc?.type === 'epub' && (
            <div
                ref={epubViewerRef}
                className={cn(
                "w-full h-full epub-viewer-container bg-background rounded-md shadow-inner",
                  (isLoadingDoc && !epubRenditionRef.current && !docErrorMessage) && "flex items-center justify-center", // Show loader only if truly loading and no error yet
                  (!isLoadingDoc && !epubRenditionRef.current && docErrorMessage) && "flex items-center justify-center p-4 text-center" 
                )}
            >
                {(isLoadingDoc && !epubRenditionRef.current && !docErrorMessage) && 
                 <Loader2 className="h-10 w-10 animate-spin text-primary" />}
                {(!isLoadingDoc && !epubRenditionRef.current && docErrorMessage) &&
                  <div className="text-destructive">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2"/>
                    <p className="font-semibold">EPUB Load Error</p>
                    <p className="text-sm">{docErrorMessage}</p>
                  </div>
                }
                 {/* Content will be rendered here by epubjs if successful */}
            </div>
        )}


        {!isLoadingDoc && activeDoc?.type === 'txt' && (
          <pre className="whitespace-pre-wrap p-4 bg-background rounded-md shadow-inner text-sm font-mono h-full overflow-y-auto select-text">{txtContent}</pre>
        )}

        {!isLoadingDoc && activeDoc?.type === 'image' && displayedImageSrc && (
            <div className="flex flex-col items-center">
                <NextImage src={displayedImageSrc} alt={activeDoc.title || 'Uploaded Image'} width={800} height={600} style={{objectFit: 'contain'}} className="max-w-full max-h-[calc(100vh-15rem)] shadow-lg border rounded-md" />
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

        { (activeDoc?.type === 'pdf' || activeDoc?.type === 'epub' || activeDoc?.type === 'image' || activeDoc?.type === 'txt') && 
          currentTextForTTS && !docErrorMessage && !isLoadingDoc && !isRenderingPdfPage && !isPerformingOcr &&
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
                {activeDoc && <CardDescription className="text-xs">Type: {activeDoc.type.toUpperCase()}{activeDoc.type === 'pdf' && pdfTotalPages > 0 ? `, Page: ${currentPdfPageNum}/${pdfTotalPages}` : ''}{activeDoc.type === 'epub' && (isLoadingDoc && !epubRenditionRef.current && !docErrorMessage) ? ` (Loading EPUB...)`: ''}</CardDescription>}
                 {!activeDoc && !isLoadingDoc && !docErrorMessage && <CardDescription className="text-xs">No document loaded. Select one from the library.</CardDescription>}
                 {/* Show general docErrorMessage if activeDoc is loaded but specific viewer has issues (like EPUB) */}
                 {docErrorMessage && activeDoc && (activeDoc.type === 'epub' || (activeDoc.type !== 'pdf' && activeDoc.type !== 'image' && activeDoc.type !== 'txt')) &&
                    <CardDescription className="text-xs text-destructive">{docErrorMessage}</CardDescription>
                 }
                 {/* Show this error if no doc could be loaded at all */}
                 {docErrorMessage && !activeDoc &&
                    <CardDescription className="text-xs text-destructive">{docErrorMessage}</CardDescription>
                 }
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
        {activeDoc?.type === 'epub' && (
          <Card>
            <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">EPUB Navigation</CardTitle></CardHeader>
            <CardContent className="flex items-center justify-between pt-0">
              <Button onClick={() => navigateEpub('prev')} size="sm" variant="outline" disabled={isLoadingDoc || !epubRenditionRef.current || isRenderingPdfPage || !epubViewerRef.current || !epubRenditionRef.current?.manager?.active }><ChevronLeft /> Previous</Button>
              <Button onClick={() => navigateEpub('next')} size="sm" variant="outline" disabled={isLoadingDoc || !epubRenditionRef.current || isRenderingPdfPage || !epubViewerRef.current || !epubRenditionRef.current?.manager?.active}>Next <ChevronRight /></Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm flex items-center gap-1"><Settings2 className="h-4 w-4"/> Text-to-Speech</CardTitle></CardHeader>
          <CardContent className="space-y-2 pt-0">
            <div>
              <Label htmlFor="tts-engine" className="text-xs">Engine</Label>
              <Select value={ttsSettings.engine} onValueChange={(v) => handleSettingChange('engine', v as 'local' | 'cloud')} disabled={(isSpeaking && !isPaused) || isLoadingDoc || isRenderingPdfPage || isPerformingOcr}>
                <SelectTrigger id="tts-engine" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="local"><div className="flex items-center gap-1 text-xs"><Smartphone className="h-3 w-3"/>Local</div></SelectItem><SelectItem value="cloud"><div className="flex items-center gap-1 text-xs"><CloudIcon className="h-3 w-3"/>Cloud</div></SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tts-language" className="text-xs">Language</Label>
              <Input id="tts-language" className="h-9 text-xs" value={ttsSettings.language} onChange={(e) => handleSettingChange('language', e.target.value)} disabled={(isSpeaking && !isPaused) || (ttsSettings.engine === 'local' && availableVoices.length === 0) || isLoadingDoc || isRenderingPdfPage || isPerformingOcr} />
            </div>
            {ttsSettings.engine === 'local' && (
              <div>
                <Label htmlFor="tts-voice" className="text-xs">Voice (Local)</Label>
                <Select 
                    value={ttsSettings.voiceURI || ""} 
                    onValueChange={(v) => handleSettingChange('voiceURI', v)} 
                    disabled={(isSpeaking && !isPaused) || availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 || isLoadingDoc || isRenderingPdfPage || isPerformingOcr}
                >
                  <SelectTrigger id="tts-voice" className="h-9 text-xs"><SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No voices available"} /></SelectTrigger>
                  <SelectContent className="max-h-48">
                    {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).map(v => (<SelectItem key={v.voiceURI || v.name} value={v.voiceURI || ""} className="text-xs">{v.name} ({v.lang})</SelectItem>))}
                    {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (<SelectItem value="no-voice-reader" disabled className="text-xs">{availableVoices.length > 0 ? "No voices for language" : "No local voices"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1"><Label htmlFor="tts-rate" className="text-xs">Rate: {ttsSettings.rate.toFixed(1)}</Label><Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={(isSpeaking && !isPaused) || isLoadingDoc || isRenderingPdfPage || isPerformingOcr}/></div>
            <div className="space-y-1"><Label htmlFor="tts-pitch" className="text-xs">Pitch: {ttsSettings.pitch.toFixed(1)}</Label><Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={(isSpeaking && !isPaused) || isLoadingDoc || isRenderingPdfPage || isPerformingOcr}/></div>
            <Button onClick={playPauseSpeech} disabled={buttonState.disabled} variant={isSpeaking && !isPaused ? "outline" : "default"} className="w-full h-9 text-sm">{buttonState.icon} {buttonState.text}</Button>
            <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="w-full mt-2 text-xs" disabled={!activeDoc || isLoadingDoc || isPerformingOcr || isRenderingPdfPage || docErrorMessage}><Star className="mr-2 h-3 w-3" /> Favorite Text/Selection</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

