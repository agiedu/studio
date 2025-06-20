
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

  // Effect to load document metadata and perform initial cleanup
  useEffect(() => {
    const loadDocumentMetadata = async () => {
      console.log("[ReaderPage] loadDocumentMetadata: Initiating document metadata load.");
      
      // --- Start Global Cleanup for any new document ---
      stopSpeech(true);
      setActiveDoc(null); // Will trigger other cleanup effects if they depend on activeDoc being nullified
      
      // PDF specific cleanup
      if (pdfDocProxy) pdfDocProxy.destroy(); // Destroy existing PDF proxy if any
      setPdfDocProxy(null);
      setCurrentPdfPageNum(1);
      setPdfTotalPages(0);
      setPdfPageImage(null);
      setPdfPageIsTextBased(true); // Reset PDF page text status
      setIsRenderingPdfPage(false);

      // Image specific cleanup
      if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
      setDisplayedImageSrc(null);

      // TXT specific cleanup
      setTxtContent("");
      
      // EPUB specific cleanup (will also be handled by its own effect, but good to be defensive)
      if (epubRenditionRef.current) {
        try { epubRenditionRef.current.destroy(); console.log("[ReaderPage] loadDocumentMetadata: Destroyed global epubRenditionRef."); }
        catch (e) { console.warn("[ReaderPage] loadDocumentMetadata: Error destroying global epubRenditionRef:", e); }
        epubRenditionRef.current = null;
      }
      if (epubBookRef.current) {
        epubBookRef.current = null; // No destroy method on book
        console.log("[ReaderPage] loadDocumentMetadata: Cleared global epubBookRef.");
      }
      if (epubViewerRef.current) {
        epubViewerRef.current.innerHTML = ''; // Clear the viewer div
        console.log("[ReaderPage] loadDocumentMetadata: Cleared epubViewerRef innerHTML.");
      }

      // General state cleanup
      setCurrentTextForTTS("");
      setDocErrorMessage(null);
      setIsLoadingDoc(true); // Set loading true for the new document
      setIsPerformingOcr(false);
      // --- End Global Cleanup ---

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
          console.log("[ReaderPage] loadDocumentMetadata: No docId to load, showing error message.");
          return;
        }
      }

      if (!docIdToLoad) { // Should be redundant if logic above is correct, but as a fallback
         setDocErrorMessage("No document selected and no previously active document found. Please go to the Library.");
         setIsLoadingDoc(false);
         console.log("[ReaderPage] loadDocumentMetadata: Still no docId after checking last active, showing error.");
         return;
      }

      try {
        console.log(`[ReaderPage] loadDocumentMetadata: Attempting to fetch docId "${docIdToLoad}" from IndexedDB.`);
        const doc = await IndexedDBService.getDocumentById(docIdToLoad);
        if (!doc) {
          setDocErrorMessage(`Document with ID "${docIdToLoad}" not found.`);
          await IndexedDBService.saveLastActiveDocId(null); // Clear invalid last active ID
          setIsLoadingDoc(false);
          console.log(`[ReaderPage] loadDocumentMetadata: Document "${docIdToLoad}" not found in DB.`);
          return;
        }

        console.log(`[ReaderPage] loadDocumentMetadata: Document "${docIdToLoad}" found. Type: ${doc.type}. Setting activeDoc.`);
        setActiveDoc(doc as ActiveMangaDocument); // This will trigger other effects for PDF, EPUB, etc.
        await IndexedDBService.saveLastActiveDocId(docIdToLoad);
        // setIsLoadingDoc will be set to false by the specific document type effects (PDF, EPUB, etc.)
        // or if no specific type effect runs, it should be handled.

      } catch (err: any) {
        console.error("[ReaderPage] loadDocumentMetadata: Error loading document from IndexedDB:", err);
        setDocErrorMessage(`Error loading document: ${err.message}`);
        setCurrentTextForTTS(`Error loading document: ${err.message}`); // Show error in TTS area too
        setIsLoadingDoc(false); // Ensure loading stops on error
      }
    };

    loadDocumentMetadata();

    // Cleanup for this main effect (when component unmounts or searchParams change)
    return () => {
      console.log("[ReaderPage] Main document loading useEffect cleanup: Stopping speech and revoking image object URL.");
      stopSpeech(true);
      if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
      // EPUB and PDF instances should be cleaned up by their own effects when activeDoc changes or component unmounts.
    };
  }, [searchParams, router, stopSpeech]); // router might not be needed but kept for safety if navigation logic is added here


  // Effect for PDF Loading
  useEffect(() => {
    if (activeDoc?.type === 'pdf' && activeDoc.fileData) {
      console.log("[ReaderPage PDF] activeDoc is PDF. Initializing PDF document proxy.");
      setIsLoadingDoc(true); // Manages loading specifically for PDF part
      setCurrentTextForTTS("Loading PDF...");
      setDocErrorMessage(null);
      
      // Ensure previous PDF proxy is destroyed if any
      if (pdfDocProxy) {
        pdfDocProxy.destroy();
        setPdfDocProxy(null);
      }

      getDocument({ data: activeDoc.fileData.slice(0) }).promise.then(pdf => {
        console.log("[ReaderPage PDF] PDF document proxy loaded. Total pages:", pdf.numPages);
        setPdfDocProxy(pdf);
        setPdfTotalPages(pdf.numPages);
        const savedPageIndex = LocalStorageService.loadCurrentPdfPageIndexForDoc(activeDoc.id);
        const pageToLoad = (savedPageIndex && savedPageIndex > 0 && savedPageIndex <= pdf.numPages) ? savedPageIndex : 1;
        setCurrentPdfPageNum(pageToLoad); // This will trigger the PDF page rendering effect
        console.log(`[ReaderPage PDF] Setting current PDF page to: ${pageToLoad}`);
        // setIsLoadingDoc(false) will be handled by page rendering effect
      }).catch(e => {
        console.error("[ReaderPage PDF] Error loading PDF document proxy:", e);
        setDocErrorMessage(`Failed to load PDF: ${e.message}`);
        setCurrentTextForTTS(`Failed to load PDF: ${e.message}`);
        setIsLoadingDoc(false); // Stop loading on PDF load error
      });
    } else if (activeDoc?.type !== 'pdf' && pdfDocProxy) {
        // If activeDoc is no longer PDF, ensure PDF resources are cleared
        console.log("[ReaderPage PDF] activeDoc is no longer PDF. Clearing PDF proxy.");
        if (pdfDocProxy) pdfDocProxy.destroy();
        setPdfDocProxy(null);
        setPdfTotalPages(0);
        setPdfPageImage(null);
        // If isLoadingDoc was true because of PDF, and now it's not PDF, ensure it's false
        // This assumes other doc types (EPUB, IMG, TXT) will set isLoadingDoc true when they start.
        if (isLoadingDoc && activeDoc && !['epub', 'image', 'txt', 'pdf'].includes(activeDoc.type)) {
             setIsLoadingDoc(false);
        }
    }
  }, [activeDoc]); // Depends only on activeDoc to initiate PDF loading

  // Effect for PDF Page Rendering
  useEffect(() => {
    if (activeDoc?.type === 'pdf' && pdfDocProxy && currentPdfPageNum > 0 && currentPdfPageNum <= pdfTotalPages) {
      console.log(`[ReaderPage PDF] Rendering PDF page ${currentPdfPageNum} of ${pdfTotalPages} with scale ${pdfScale}.`);
      stopSpeech(true);
      setIsRenderingPdfPage(true);
      setPdfPageImage(null); // Clear previous page image
      setPdfPageIsTextBased(true); // Assume text-based until checked
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

        const pdfDoc = activeDoc as StoredPdfDocument;
        if (pdfDoc.ocrTextPerPage?.[currentPdfPageNum]) {
            console.log(`[ReaderPage PDF] Page ${currentPdfPageNum} has pre-existing OCR text.`);
            setCurrentTextForTTS(pdfDoc.ocrTextPerPage[currentPdfPageNum]);
            setPdfPageIsTextBased(false); // If using OCR text, likely it wasn't text-based
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
        setIsLoadingDoc(false); // Content for this page is now loaded/rendered
      }).catch(e => {
        console.error(`[ReaderPage PDF] Error rendering PDF page ${currentPdfPageNum}:`, e);
        setPdfPageImage(null);
        setCurrentTextForTTS(`Error rendering PDF page ${currentPdfPageNum}: ${e.message}`);
        setPdfPageIsTextBased(false); // Assume error means no text
        setIsLoadingDoc(false); // Stop loading on page render error
      }).finally(() => {
        setIsRenderingPdfPage(false);
        console.log(`[ReaderPage PDF] Finished rendering attempt for page ${currentPdfPageNum}.`);
      });
    }
  }, [pdfDocProxy, currentPdfPageNum, pdfTotalPages, pdfScale, activeDoc, stopSpeech]);


  // Effect for EPUB Loading and Rendering
  useEffect(() => {
    // Condition to run this effect: activeDoc is EPUB, has fileData. Viewer ref check is inside.
    if (activeDoc?.type !== 'epub' || !activeDoc.fileData) {
      // If not an EPUB or no data, ensure any existing EPUB resources are cleaned up.
      if (epubRenditionRef.current) {
        try { epubRenditionRef.current.destroy(); console.log("[ReaderPage EPUB] Cleanup: Destroyed epubRenditionRef (activeDoc not EPUB)."); }
        catch(e) { console.warn("[ReaderPage EPUB] Cleanup: Error destroying epubRenditionRef (activeDoc not EPUB):", e); }
        epubRenditionRef.current = null;
      }
      if (epubBookRef.current) {
        epubBookRef.current = null; // No destroy method on book
        console.log("[ReaderPage EPUB] Cleanup: Cleared epubBookRef (activeDoc not EPUB).");
      }
      if (epubViewerRef.current) { // If viewer existed but doc changed
          epubViewerRef.current.innerHTML = '';
      }
      // If main loading indicator was for EPUB, but it's no longer EPUB, ensure it's false.
      // This check is a bit broad, might need refinement based on other loaders.
      if (isLoadingDoc && activeDoc && activeDoc.type !== 'epub') {
         // Consider if this setIsLoadingDoc(false) is always correct here.
         // If another loader (PDF, IMG) is active, it might cause issues.
         // For now, assume if it's not EPUB, this effect is not responsible for isLoadingDoc.
      }
      return; // Exit if not an EPUB
    }

    // At this point, activeDoc IS an EPUB and has fileData.
    // Now, check if the viewer DOM element is ready.
    if (!epubViewerRef.current) {
      console.warn("[ReaderPage EPUB] epubViewerRef.current is null. Deferring EPUB initialization until viewer div is rendered.");
      // This state can occur if activeDoc is set, but the conditional render of the epubViewer div hasn't completed.
      // React should re-run this effect once the div is in the DOM.
      setDocErrorMessage("EPUB viewer element not ready. Waiting for DOM to render...");
      setCurrentTextForTTS(""); // Clear any stale text
      // If this is the first time trying to load this EPUB, and viewer isn't ready,
      // we might want to keep isLoadingDoc true, or set a specific "waiting for viewer" message.
      // For simplicity, if isLoadingDoc is already true from main loader, let it be.
      // If it became false due to some other path, and now we are here, that's a tricky state.
      // Safest might be to set isLoadingDoc false if we can't proceed.
      if (isLoadingDoc) setIsLoadingDoc(false); 
      return; // Exit effect, will re-run when/if epubViewerRef.current becomes available
    }

    // If we reach here: activeDoc is EPUB, has fileData, AND epubViewerRef.current is available.
    
    let localBookInstance: EpubBook | null = null;
    let localRenditionInstance: Rendition | null = null;

    const initializeEpub = async () => {
      console.log("[ReaderPage EPUB] Initializing EPUB for doc:", activeDoc.id);
      setIsLoadingDoc(true);
      setCurrentTextForTTS("Loading EPUB...");
      setDocErrorMessage(null); // Clear previous errors

      // Explicitly destroy global refs before re-assigning, and clear viewer
      // This ensures that if this effect runs multiple times for the same activeDoc (e.g., due to other state changes),
      // it always starts fresh with the global refs.
      if (epubRenditionRef.current) {
        try { epubRenditionRef.current.destroy(); console.log("[ReaderPage EPUB] Init: Destroyed existing global epubRenditionRef."); }
        catch (e) { console.warn("[ReaderPage EPUB] Init: Error destroying old global epubRenditionRef:", e); }
        epubRenditionRef.current = null;
      }
      if (epubBookRef.current) {
        epubBookRef.current = null;
        console.log("[ReaderPage EPUB] Init: Cleared existing global epubBookRef.");
      }
      if (epubViewerRef.current) { // Should be non-null due to check above
        epubViewerRef.current.innerHTML = ''; 
        console.log("[ReaderPage EPUB] Init: Cleared epubViewerRef.current.innerHTML.");
      }


      try {
        const ePubModule = await import('epubjs');
        const EPub = ePubModule.default;
        localBookInstance = EPub(activeDoc.fileData); // Use local var for the instance being created
        console.log("[ReaderPage EPUB] EpubBook instance created:", localBookInstance.id);

        await localBookInstance.ready;
        // After await, re-check conditions, especially if activeDoc changed or viewer disappeared
        if (!epubViewerRef.current || !activeDoc || activeDoc.type !== 'epub' || activeDoc.id !== localBookInstance.id) {
            console.warn("[ReaderPage EPUB] Conditions changed during book.ready (e.g., document changed, viewer disappeared). Aborting EPUB setup for:", localBookInstance.id);
            if (localBookInstance && epubBookRef.current && epubBookRef.current.id === localBookInstance.id) epubBookRef.current = null; // If global was set to this one
            setIsLoadingDoc(false);
            return;
        }
        console.log("[ReaderPage EPUB] Book ready:", localBookInstance.id);

        localRenditionInstance = localBookInstance.renderTo(epubViewerRef.current, {
          width: "100%",
          height: "100%",
          flow: "paginated", // Ensure single page flow
          spread: "none",   // Ensure single page spread
        });
        console.log("[ReaderPage EPUB] Rendition instance created:", localRenditionInstance.id);

        localRenditionInstance.on('displayed', (section: any) => {
          // Check if this rendition is still the active one
          if (!localRenditionInstance || !epubRenditionRef.current || localRenditionInstance.id !== epubRenditionRef.current.id) {
              console.log("[ReaderPage EPUB] 'displayed' event for a stale rendition. Ignoring. Current Rendition ID:", epubRenditionRef.current?.id, "Event Rendition ID:", localRenditionInstance?.id);
              return;
          }
          console.log("[ReaderPage EPUB] Rendition 'displayed' event for section:", section.idref);
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
            console.log(`[ReaderPage EPUB] Extracted text length: ${text.length}`);
          } catch (textExtractError: any) {
            console.error("[ReaderPage EPUB] Error extracting text from EPUB section:", textExtractError);
            setCurrentTextForTTS(`Error extracting text from EPUB: ${textExtractError.message}`);
          }
        });

        await localRenditionInstance.display();
        // After await, re-check conditions again
        if (!epubViewerRef.current || !activeDoc || activeDoc.type !== 'epub' || activeDoc.id !== localBookInstance.id || !localRenditionInstance) {
            console.warn("[ReaderPage EPUB] Conditions changed during rendition.display. Aborting EPUB setup for:", localBookInstance.id);
            if (localRenditionInstance) { try { localRenditionInstance.destroy(); console.log("[ReaderPage EPUB] Destroyed localRenditionInstance due to changed conditions post-display."); } catch(err){/*ignore*/} }
            if (localBookInstance && epubBookRef.current && epubBookRef.current.id === localBookInstance.id) epubBookRef.current = null;
            setIsLoadingDoc(false);
            return;
        }
        
        // If all successful, now assign to global refs
        epubBookRef.current = localBookInstance;
        epubRenditionRef.current = localRenditionInstance;
        console.log("[ReaderPage EPUB] Rendition displayed. Global refs updated. Book ID:", epubBookRef.current?.id, "Rendition ID:", epubRenditionRef.current?.id);

      } catch (e: any) {
        console.error("[ReaderPage EPUB] Error during EPUB initialization process:", e);
        const errorMsg = e instanceof Error ? e.message : String(e);
        let userFriendlyError = `Failed to load EPUB: ${errorMsg}`;
        if (errorMsg.toLowerCase().includes("uncompressed data size mismatch") || errorMsg.toLowerCase().includes("reading 'package')")) {
            userFriendlyError = `Failed to load EPUB: The file might be corrupted or not a valid EPUB. (Detail: ${errorMsg})`;
        } else if (errorMsg.toLowerCase().includes("cannot read properties of undefined (reading 'package')")){
            userFriendlyError = `Failed to load EPUB: Error initializing EPUB reader. The file might be incompatible. (Detail: ${errorMsg})`;
        }
        setDocErrorMessage(userFriendlyError);
        setCurrentTextForTTS(userFriendlyError);

        // Ensure cleanup of local instances if they were created before error
        if (localRenditionInstance) { try { localRenditionInstance.destroy(); console.log("[ReaderPage EPUB] Catch: Destroyed localRenditionInstance.");} catch(errDestroy){ console.warn("Error destroying localRenditionInstance on catch:", errDestroy); } }
        if (epubViewerRef.current) epubViewerRef.current.innerHTML = ''; // Clear viewer on error
        
        // Also clear global refs if they somehow got set or were from a previous attempt for this doc
        epubBookRef.current = null;
        epubRenditionRef.current = null;
      } finally {
        setIsLoadingDoc(false);
        console.log("[ReaderPage EPUB] Finished EPUB initialization attempt for doc:", activeDoc?.id);
      }
    };

    initializeEpub();

    // Cleanup function for this useEffect
    return () => {
      console.log("[ReaderPage EPUB] Cleanup for useEffect [activeDoc]. Current activeDoc ID:", activeDoc?.id, "Attempting to destroy rendition:", epubRenditionRef.current?.id);
      // This cleanup runs when `activeDoc` changes (before the new effect run for the new `activeDoc`) or when the component unmounts.
      // It should destroy the rendition that is currently in the global ref, as that's the one associated with the `activeDoc`
      // for which this effect instance is now being cleaned up.
      if (epubRenditionRef.current) {
        try {
          epubRenditionRef.current.destroy();
          console.log("[ReaderPage EPUB] Cleanup: Successfully destroyed epubRenditionRef.current:", epubRenditionRef.current.id);
        } catch (e) {
          console.warn("[ReaderPage EPUB] Cleanup: Error destroying epubRenditionRef.current:", e);
        }
        epubRenditionRef.current = null;
      }
       if (epubBookRef.current) {
        // epub.js Book doesn't have a destroy method. Just nullify the ref.
        epubBookRef.current = null;
        console.log("[ReaderPage EPUB] Cleanup: Cleared epubBookRef.current.");
      }
      // Do not clear epubViewerRef.current.innerHTML here if another EPUB might be loading immediately after.
      // The initialization part of the new effect run should handle clearing the viewer for the new book.
    };
  }, [activeDoc, stopSpeech]); // stopSpeech might be needed if TTS starts on load


  // Effect for TXT file loading
  useEffect(() => {
    if (activeDoc?.type === 'txt' && activeDoc.fileData) {
        console.log("[ReaderPage TXT] activeDoc is TXT. Decoding file data.");
        setIsLoadingDoc(true);
        setCurrentTextForTTS("Loading text file...");
        setDocErrorMessage(null);
        try {
            const decoder = new TextDecoder(); // Use default (UTF-8) or allow selection later
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
    } else if (activeDoc?.type !== 'txt') {
        setTxtContent(""); // Clear content if not a TXT doc
        // If isLoadingDoc was true due to TXT loading, and it's no longer TXT, ensure it's false
        // This requires careful thought about how isLoadingDoc is managed across all doc types
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
            // Revoke previous object URL if it exists
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
    } else if (activeDoc?.type !== 'image') {
        // If not an image doc, ensure cleanup
        if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
        setDisplayedImageSrc(null);
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
    const currentActiveDoc = activeDoc; // Capture current activeDoc for async operations

    if (currentActiveDoc.type === 'pdf' && pdfPageImage && !pdfPageIsTextBased) {
        // For PDF, if current page is rendered as an image and deemed not text-based
        dataUrlToProcess = pdfPageImage;
        console.log("[ReaderPage OCR] Using current PDF page image for OCR.");
    } else if (currentActiveDoc.type === 'image' && currentActiveDoc.fileData) {
        // For Image documents, convert ArrayBuffer to base64 data URL
        console.log("[ReaderPage OCR] Preparing image document for OCR from ArrayBuffer.");
        try {
            // Re-fetch the document to ensure we have the latest fileData, just in case.
            // Though activeDoc should ideally be up-to-date.
            const docToProcess = await IndexedDBService.getDocumentById(currentActiveDoc.id);
            if (!docToProcess || !docToProcess.fileData || !docToProcess.originalType) {
                toast({variant: "destructive", title: "OCR Error", description: "Image data or type is missing for OCR."});
                setIsPerformingOcr(false); // Ensure state is reset
                console.error("[ReaderPage OCR] Image data or type missing from fetched doc for OCR.");
                return;
            }
            dataUrlToProcess = await IndexedDBService.arrayBufferToBase64DataURL(docToProcess.fileData, docToProcess.originalType);
            console.log("[ReaderPage OCR] Image converted to Base64 data URL for OCR.");
        } catch (conversionError: any) {
          toast({variant: "destructive", title: "OCR Error", description: `Could not prepare image data for OCR: ${conversionError.message}`});
          console.error("[ReaderPage OCR] Error converting image ArrayBuffer to Base64 for OCR:", conversionError);
          setIsPerformingOcr(false); // Ensure state is reset
          return;
        }
    }

    if (!dataUrlToProcess) {
        toast({ variant: "destructive", title: "OCR Error", description: "No image data available for OCR for the current document type or state." });
        setIsPerformingOcr(false); // Ensure state is reset
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

            // Update the document in IndexedDB with the new OCR text
            // And update the activeDoc state
            const updatedDocFields: Partial<ActiveMangaDocument> = {};
            if (currentActiveDoc.type === 'image') {
                (updatedDocFields as Partial<StoredImageDocument>).extractedText = ocrText;
            } else if (currentActiveDoc.type === 'pdf') {
                // Ensure ocrTextPerPage exists before trying to update it
                const existingOcrTextPerPage = (currentActiveDoc as StoredPdfDocument).ocrTextPerPage || {};
                const ocrPages = { ...existingOcrTextPerPage, [currentPdfPageNum]: ocrText };
                (updatedDocFields as Partial<StoredPdfDocument>).ocrTextPerPage = ocrPages;
            }

            // Create a new object for state update to ensure React detects the change
            const newActiveDocState = { ...currentActiveDoc, ...updatedDocFields } as ActiveMangaDocument;
            await IndexedDBService.saveDocument(newActiveDocState);
            setActiveDoc(newActiveDocState); // Update the local state
            console.log("[ReaderPage OCR] Updated document saved to IndexedDB and activeDoc state updated.");

        } else {
            // OCR action returned an error
            setCurrentTextForTTS(`OCR Error: ${result.error}`);
            toast({ variant: "destructive", title: "OCR Error", description: result.error });
            console.error(`[ReaderPage OCR] OCR action returned error: ${result.error}`);
        }
    } catch (e: any) {
        // Catch errors from the performOCR call itself (e.g., network issues)
        console.error("[ReaderPage OCR] Detailed OCR error from server action call:", e);
        setCurrentTextForTTS(`OCR failed: ${e.message}`);
        toast({ variant: "destructive", title: "OCR Failed", description: e.message });
    } finally {
        setIsPerformingOcr(false);
        console.log("[ReaderPage OCR] Finished OCR attempt.");
    }
  }, [activeDoc, pdfPageImage, pdfPageIsTextBased, currentPdfPageNum, stopSpeech, toast]);

  // Effect for TTS settings loading and voice list population
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const loadedSettings = LocalStorageService.loadTTSSettings();
      // Ensure engine and type are consistent
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
    populateVoiceList(); // Initial population
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = populateVoiceList;
      console.log("[ReaderPage TTS] Attached onvoiceschanged listener.");
    }
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.onvoiceschanged = null;
          console.log("[ReaderPage TTS] Detached onvoiceschanged listener.");
      }
      stopSpeech(true); // Ensure speech stops on component unmount
    };
  }, [populateVoiceList, stopSpeech]);

  // Effect to update TTS settings (especially voice) based on availability and current settings
 useEffect(() => {
    let settingsToSave = { ...ttsSettings }; // Work with a copy
    let changesMadeToSettingsState = false;

    // This logic primarily applies to 'local' engine for voice selection
    if (typeof window !== 'undefined' && window.speechSynthesis && settingsToSave.engine === 'local') {
        // Use already populated `availableVoices` state if possible, otherwise fetch fresh
        const systemVoices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService, default: v.default }));

        if (systemVoices.length > 0) {
            let voiceToSet: TTSVoice | undefined = settingsToSave.voiceURI ? systemVoices.find(v => v.voiceURI === settingsToSave.voiceURI) : undefined;
            let langToSet = settingsToSave.language; // Start with current language

            // Validate if the current voiceURI is suitable for the selected language
            // A voice is suitable if its language exactly matches or starts with the primary language subtag (e.g., 'en' for 'en-US')
            const currentVoiceIsValidForLanguage = voiceToSet && voiceToSet.lang && 
                                                   (voiceToSet.lang === settingsToSave.language || voiceToSet.lang.startsWith(settingsToSave.language.split('-')[0]));

            if (!voiceToSet || !currentVoiceIsValidForLanguage) {
                // Attempt to find a default or suitable voice for the current language
                const defaultForLang = systemVoices.find(v => v.lang === settingsToSave.language && v.default) ||
                                     systemVoices.find(v => v.lang === settingsToSave.language) ||
                                     systemVoices.find(v => v.lang?.startsWith(settingsToSave.language.split('-')[0]) && v.default) ||
                                     systemVoices.find(v => v.lang?.startsWith(settingsToSave.language.split('-')[0]));

                if (defaultForLang && defaultForLang.lang) {
                    voiceToSet = defaultForLang;
                    langToSet = defaultForLang.lang; // Update language to the chosen voice's specific lang
                } else {
                    // If no voice for the specific language, try a broader system default or the first available voice
                    const absoluteFallback = systemVoices.find(v => v.default && v.lang) || (systemVoices.length > 0 ? systemVoices[0] : undefined);
                    if (absoluteFallback && absoluteFallback.lang) {
                        voiceToSet = absoluteFallback;
                        langToSet = absoluteFallback.lang; // Update language if falling back
                    } else {
                        // No voices available at all or no voices with language property
                        voiceToSet = undefined;
                        // Keep langToSet as is, or reset to a default if no voices
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
        } else { // No system voices available
             if(settingsToSave.voiceURI !== undefined) { // If a voiceURI was set but no voices exist
                settingsToSave.voiceURI = undefined;
                changesMadeToSettingsState = true;
                console.log("[ReaderPage TTS] No system voices. Cleared voiceURI.");
             }
        }
    } else if (settingsToSave.engine === 'cloud') {
        // Cloud engine doesn't use local voiceURI, so ensure it's undefined
        if (settingsToSave.voiceURI !== undefined) {
            settingsToSave.voiceURI = undefined;
            changesMadeToSettingsState = true;
            console.log("[ReaderPage TTS] Engine set to cloud. Cleared voiceURI.");
        }
    }

    // If any relevant part of ttsSettings changed that requires a state update and save
    if (changesMadeToSettingsState || 
        settingsToSave.rate !== ttsSettings.rate ||
        settingsToSave.pitch !== ttsSettings.pitch
        // No need to compare engine or language directly if they triggered changesMade
        ) {
      if(changesMadeToSettingsState) { // Only update state if voice/lang logic made changes
        setTtsSettings(settingsToSave);
      }
      LocalStorageService.saveTTSSettings(settingsToSave); // Always save the potentially modified settingsToSave
      console.log("[ReaderPage TTS] Saved TTS settings to localStorage:", settingsToSave);
    }
// Key dependencies: engine, language, voiceURI (direct user changes), availableVoices (system changes), rate, pitch
}, [ttsSettings.engine, ttsSettings.language, ttsSettings.voiceURI, availableVoices, ttsSettings.rate, ttsSettings.pitch]);


  // Effect for Audio Player setup (for cloud TTS)
  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player; // Assign to ref

    const handleAudioEnded = () => { 
      if (audioPlayerRef.current === player && isSpeaking && ttsSettings.engine === 'cloud') {
        console.log("[ReaderPage CloudTTS] Audio ended.");
        stopSpeech(true); 
      }
    };
    const handleAudioPlaying = () => { 
      if (audioPlayerRef.current === player && ttsSettings.engine === 'cloud' && isSpeaking) {
        console.log("[ReaderPage CloudTTS] Audio playing.");
        setIsLoadingTTS(false); // Cloud TTS is now playing, no longer loading
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
        player.src = ""; // Release resource
        if (audioPlayerRef.current === player) { // Ensure we're nullifying the correct ref
          audioPlayerRef.current = null;
          console.log("[ReaderPage CloudTTS] audioPlayerRef.current set to null.");
        }
    };
  }, [ttsSettings.engine, isSpeaking, stopSpeech, toast]); // Dependencies that affect cloud playback

  const playPauseSpeech = async () => {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    const selectedTextFromSelection = selection?.toString().trim();
    const effectiveTextToRead = selectedTextFromSelection || currentTextForTTS;

    console.log("[ReaderPage TTS] playPauseSpeech called. isSpeaking:", isSpeaking, "isPaused:", isPaused, "Selected text length:", selectedTextFromSelection?.length, "Current TTS text length:", currentTextForTTS.length);

    const invalidMessages = [
      "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...",
      "Image loaded. Perform OCR", "No text content found", "Could not extract text",
      "EPUB viewer element not ready", "EPUB section loaded, but text extraction",
      "This PDF page has no selectable text", "MOBI files cannot be read directly.",
      "This PDF page seems to be an image. Use OCR to extract text.",
      "Performing OCR...", "No document ID provided", "Document with ID",
       "EPUB viewer element is not available in the DOM yet", "EPUB viewer element not yet available. Waiting for render.",
       "EPUB viewer element not ready. Waiting for render.", 
      "EPUB viewer element not ready", "MOBI file format is not directly supported",
      "OCR completed, but no text found.",
      "No document selected.", "No document selected and no previously active document found."
    ];

    if (!effectiveTextToRead || invalidMessages.some(msg => effectiveTextToRead.startsWith(msg)) || effectiveTextToRead.length < MIN_TTS_TEXT_LENGTH) {
      toast({ variant: "destructive", title: "No Valid Text", description: `No valid text to read, text is a placeholder, or text is too short (min ${MIN_TTS_TEXT_LENGTH} chars). Current text: "${effectiveTextToRead.substring(0,50)}..."` });
      console.warn("[ReaderPage TTS] No valid text to read. Effective text:", effectiveTextToRead.substring(0,100));
      return;
    }

    if (isSpeaking) {
      if (isPaused) { // Resume
        console.log("[ReaderPage TTS] Resuming speech. Engine:", ttsSettings.engine);
        if (ttsSettings.engine === 'local' && utteranceRef.current && window.speechSynthesis?.paused) { window.speechSynthesis.resume(); setIsPaused(false); }
        else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current?.paused) { 
            audioPlayerRef.current.play().then(() => setIsPaused(false)).catch((e) => { console.error("Error resuming cloud TTS:", e); stopSpeech(true); });
        } else {
            console.warn("[ReaderPage TTS] Resume called but conditions not met. Utterance:", !!utteranceRef.current, "Synth Paused:", window.speechSynthesis?.paused, "Audio Paused:", audioPlayerRef.current?.paused);
            // stopSpeech(true); // If in weird state, reset
        }
      } else { // Pause
        console.log("[ReaderPage TTS] Pausing speech. Engine:", ttsSettings.engine);
        if (ttsSettings.engine === 'local' && utteranceRef.current && window.speechSynthesis?.speaking) { window.speechSynthesis.pause(); setIsPaused(true); }
        else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current && !audioPlayerRef.current.paused) { audioPlayerRef.current.pause(); setIsPaused(true); }
        else {
            console.warn("[ReaderPage TTS] Pause called but conditions not met. Utterance:", !!utteranceRef.current, "Synth Speaking:", window.speechSynthesis?.speaking, "Audio Playing:", !audioPlayerRef.current?.paused);
            // stopSpeech(true); // If in weird state, reset
        }
      }
    } else { // Start speech
      stopSpeech(false); // Clear any previous speech, but don't reset all UI yet
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
            if (ttsSettings.voiceURI) { // Prefer the voiceURI from settings if valid for current language
                voiceToUse = systemVoices.find(v => v.voiceURI === ttsSettings.voiceURI && v.lang.startsWith(ttsSettings.language.split('-')[0]));
            }
            if (!voiceToUse && ttsSettings.language) { // Fallback to language-based match
                voiceToUse = systemVoices.find(v => v.lang === ttsSettings.language && v.default) ||
                             systemVoices.find(v => v.lang === ttsSettings.language) ||
                             systemVoices.find(v => v.lang?.startsWith(ttsSettings.language.split('-')[0]) && v.default) ||
                             systemVoices.find(v => v.lang?.startsWith(ttsSettings.language.split('-')[0]));
            }
            if (!voiceToUse) { // Absolute fallback
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
        setIsLoadingTTS(false); // Local TTS usually starts quickly
      } else { // Cloud TTS
        console.log("[ReaderPage TTS] Requesting Cloud TTS.");
        try {
          const result = await getCloudSpeech(effectiveTextToRead, ttsSettings.language);
          if ('audioUrl' in result && audioPlayerRef.current) {
            console.log("[ReaderPage TTS] Cloud TTS audio URL received:", result.audioUrl);
            audioPlayerRef.current.src = result.audioUrl;
            await audioPlayerRef.current.play();
            // setIsLoadingTTS(false) will be handled by the 'playing' event of the audio player
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
    stopSpeech(true); // Stop any ongoing speech when settings change

    setTtsSettings(prevSettings => {
        let newSettings = { ...prevSettings, [key]: value };

        // If engine or type (which are now aliases) changes, update both
        if (key === 'engine') {
            newSettings.type = value as 'local' | 'cloud'; // Update type to match engine
        }
        if (key === 'type') {
            newSettings.engine = value as 'local' | 'cloud'; // Update engine to match type
        }

        // If switching to cloud, voiceURI is not applicable
        if ((key === 'engine' || key === 'type') && newSettings.engine === 'cloud') {
            newSettings.voiceURI = undefined;
        }
        // If language is changed for local engine, voiceURI might need re-evaluation (handled by the dedicated voice selection useEffect)
        // If voiceURI is changed directly, that's a user selection.
        
        // The main useEffect for TTS settings (dependent on engine, lang, voiceURI, availableVoices)
        // will handle saving to LocalStorage and further adjustments like finding a default voice.
        return newSettings;
    });
  };


  const handleFavoriteSelection = () => {
    const selection = window.getSelection()?.toString().trim() || currentTextForTTS;
    console.log("[ReaderPage Fav] handleFavoriteSelection. Current text for TTS length:", currentTextForTTS.length, "Selection length:", window.getSelection()?.toString().trim()?.length);
    
    const invalidMessages = [
      "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...",
      "Image loaded. Perform OCR", "No text content found", "Could not extract text",
      "EPUB viewer element not ready", "EPUB section loaded, but text extraction",
      "This PDF page has no selectable text", "MOBI files cannot be read directly.",
      "This PDF page seems to be an image. Use OCR to extract text.",
      "Performing OCR...", "No document ID provided", "Document with ID",
       "EPUB viewer element is not available in the DOM yet", "EPUB viewer element not yet available. Waiting for render.",
       "EPUB viewer element not ready. Waiting for render.",
      "EPUB viewer element not ready", "MOBI file format is not directly supported",
      "OCR completed, but no text found.",
      "No document selected.", "No document selected and no previously active document found."
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
    stopSpeech(true); // Stop speech as page content will change
    setPdfScale(newScale);
  };

  const navigateEpub = (direction: 'prev' | 'next') => {
    if (!epubRenditionRef.current || isLoadingDoc) return; // isLoadingDoc check for EPUB safety
    stopSpeech(true); // Stop speech before changing EPUB section
    if (direction === 'prev') epubRenditionRef.current.prev(); else epubRenditionRef.current.next();
  };

  const getButtonState = () => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const effectiveText = selectedText || currentTextForTTS;
    const invalidMessages = [ // Keep this list consistent
      "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...",
      "Image loaded. Perform OCR", "No text content found", "Could not extract text",
      "EPUB viewer element not ready", "EPUB section loaded, but text extraction",
      "This PDF page has no selectable text", "MOBI files cannot be read directly.",
      "This PDF page seems to be an image. Use OCR to extract text.",
      "Performing OCR...", "No document ID provided", "Document with ID",
       "EPUB viewer element is not available in the DOM yet", "EPUB viewer element not yet available. Waiting for render.",
       "EPUB viewer element not ready. Waiting for render.",
      "EPUB viewer element not ready", "MOBI file format is not directly supported",
      "OCR completed, but no text found.",
      "No document selected.", "No document selected and no previously active document found."
    ];
    const canPlay = !!(effectiveText && !invalidMessages.some(msg => effectiveText.startsWith(msg)) && effectiveText.length >= MIN_TTS_TEXT_LENGTH && activeDoc && !isLoadingDoc && !isPerformingOcr && !isRenderingPdfPage && !docErrorMessage);

    if (isLoadingTTS) return { text: "Loading...", icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, disabled: true };
    if (isSpeaking && !isPaused) return { text: "Pause", icon: <Pause className="mr-1 h-4 w-4" />, disabled: false };
    if (isSpeaking && isPaused) return { text: "Resume", icon: <Play className="mr-1 h-4 w-4" />, disabled: false };
    return { text: selectedText ? "Play Selected" : "Play Text", icon: <Play className="mr-1 h-4 w-4" />, disabled: !canPlay };
  };
  const buttonState = getButtonState();

  // If still loading initial docId determination and no activeDoc yet and no specific error message
  if (isLoadingDoc && !activeDoc && !docErrorMessage) {
    return <div className="flex items-center justify-center h-full flex-grow"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-lg">Loading document...</p></div>;
  }

  // If there's a critical document-level error message and no specific content type can be rendered
  // (e.g., doc not found, or a general loading error not specific to PDF/EPUB rendering phases)
  if (docErrorMessage && (!activeDoc || (activeDoc && !['pdf', 'epub', 'txt', 'image'].includes(activeDoc.type))) ) {
    return <div className="flex flex-col items-center justify-center h-full flex-grow p-4 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-xl font-semibold mb-2">Error Loading Document</h2>
        <p className="text-muted-foreground mb-4">{docErrorMessage}</p>
        <Button onClick={() => router.push('/library')}>Go to Library</Button>
    </div>;
  }
  
  // Determine if OCR button should be shown for PDF (if page is image-like)
  const showOcrButtonForPdfPage = activeDoc?.type === 'pdf' && !pdfPageIsTextBased && pdfPageImage && !isRenderingPdfPage && !isLoadingDoc && !isPerformingOcr;
  // Determine if OCR button should be shown for Image (if no extracted text yet)
  const showOcrButtonForImage = activeDoc?.type === 'image' && displayedImageSrc && !isLoadingDoc && !isPerformingOcr && !(activeDoc as StoredImageDocument).extractedText;


  return (
    <div className="flex flex-col lg:flex-row w-full h-[calc(100vh-4rem)]"> {/* Ensure header height is accounted for */}
      {/* Main Content Area */}
      <div className="flex-grow overflow-y-auto bg-muted/20 p-2 md:p-4 relative">
        {/* Global loading indicator or error message for specific document content rendering phases */}
         {docErrorMessage && activeDoc && (activeDoc.type === 'epub' || activeDoc.type === 'pdf') && (
            // This error message is for issues specific to PDF/EPUB rendering AFTER activeDoc is set
            <div className="absolute inset-x-0 top-4 mx-auto w-fit max-w-md bg-destructive/10 border border-destructive text-destructive p-3 rounded-md shadow-lg z-10 flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div>
                    <p className="font-medium text-sm">Document Display Issue</p>
                    <p className="text-xs">{docErrorMessage}</p>
                     <Button variant="ghost" size="sm" className="text-xs h-auto p-1 mt-1 text-destructive hover:bg-destructive/20" onClick={() => setDocErrorMessage(null)}>Dismiss</Button>
                </div>
            </div>
        )}

        {/* General loading indicator for when content is being fetched/rendered for a specific type */}
        {isLoadingDoc && (activeDoc?.type === 'pdf' || activeDoc?.type === 'epub' || activeDoc?.type === 'image' || activeDoc?.type === 'txt') &&
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-10 w-10 animate-spin text-primary" /><p className="ml-3">Loading content for {activeDoc.type.toUpperCase()}...</p>
            </div>
        }

        {/* PDF Content */}
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

        {/* EPUB Content */}
        {/* The div for EPUB is always in the DOM structure if activeDoc.type is 'epub', controlled by the outer conditional rendering logic */}
        {activeDoc?.type === 'epub' && (
            <div
                ref={epubViewerRef}
                className={cn(
                "w-full h-full epub-viewer-container bg-background rounded-md shadow-inner",
                // Show loader inside if isLoadingDoc (for EPUB specifically) AND no rendition yet AND no error
                (isLoadingDoc && !epubRenditionRef.current && !docErrorMessage) && "flex items-center justify-center" 
                )}
            >
                {(isLoadingDoc && !epubRenditionRef.current && !docErrorMessage && activeDoc.type === 'epub') && 
                 <Loader2 className="h-10 w-10 animate-spin text-primary" />}
                {/* If there's an EPUB-specific error and no rendition, it will be handled by the global error message above */}
            </div>
        )}


        {/* TXT Content */}
        {!isLoadingDoc && activeDoc?.type === 'txt' && (
          <pre className="whitespace-pre-wrap p-4 bg-background rounded-md shadow-inner text-sm font-mono h-full overflow-y-auto select-text">{txtContent}</pre>
        )}

        {/* Image Content */}
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

        {/* MOBI Placeholder/Error */}
         {!isLoadingDoc && activeDoc?.type === 'mobi' && (
           <div className="p-4 bg-background rounded-md shadow-inner text-center h-full flex flex-col justify-center items-center">
             <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2"/>
             <p className="font-semibold">MOBI File Format Not Supported</p>
             <p className="text-sm text-muted-foreground">Reading MOBI files directly is not supported. Please convert your MOBI file to EPUB or PDF format and upload it again.</p>
           </div>
         )}

        {/* Current Text for TTS Area - Show if there's text and no critical doc error AND not loading the main doc content */}
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

      {/* Sidebar Controls */}
      <div className="w-full lg:w-80 xl:w-96 p-3 border-l bg-background flex-shrink-0 overflow-y-auto space-y-4">
        <Card>
            <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-base truncate flex items-center gap-1">
                    <BookOpen className="h-5 w-5 text-primary"/> {activeDoc?.title || "No Document Loaded"}
                </CardTitle>
                {activeDoc && <CardDescription className="text-xs">Type: {activeDoc.type.toUpperCase()}{activeDoc.type === 'pdf' && pdfTotalPages > 0 ? `, Page: ${currentPdfPageNum}/${pdfTotalPages}` : ''}{activeDoc.type === 'epub' && (isLoadingDoc && !epubRenditionRef.current && !docErrorMessage) ? ` (Loading EPUB...)`: ''}</CardDescription>}
                 {!activeDoc && !isLoadingDoc && !docErrorMessage && <CardDescription className="text-xs">No document loaded. Select one from the library.</CardDescription>}
                 {docErrorMessage && (!activeDoc || !['pdf', 'epub', 'txt', 'image'].includes(activeDoc.type) || (activeDoc.type==='epub' && !epubRenditionRef.current)) &&
                    <CardDescription className="text-xs text-destructive">{docErrorMessage}</CardDescription>
                 }

            </CardHeader>
        </Card>

        {/* PDF Controls */}
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
        {/* EPUB Controls */}
        {activeDoc?.type === 'epub' && (
          <Card>
            <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">EPUB Navigation</CardTitle></CardHeader>
            <CardContent className="flex items-center justify-between pt-0">
              <Button onClick={() => navigateEpub('prev')} size="sm" variant="outline" disabled={isLoadingDoc || !epubRenditionRef.current || isRenderingPdfPage /* EPUB doesn't have isRenderingPdfPage but disable if general loading */}><ChevronLeft /> Previous</Button>
              <Button onClick={() => navigateEpub('next')} size="sm" variant="outline" disabled={isLoadingDoc || !epubRenditionRef.current || isRenderingPdfPage}>Next <ChevronRight /></Button>
            </CardContent>
          </Card>
        )}

        {/* TTS Controls */}
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

    