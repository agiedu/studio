
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
import type { TTSSettings, TTSVoice, StoredMangaDocument, ActiveMangaDocument, StoredPdfDocument, StoredImageDocument } from '@/types';
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

  // Effect to load document metadata (triggers other effects for specific types)
  useEffect(() => {
    const loadDocumentMetadata = async () => {
      console.log("[ReaderPage] loadDocumentMetadata: Initiating document metadata load.");
      // Reset states before loading new document metadata
      setActiveDoc(null); // This will trigger EPUB cleanup if previous was EPUB
      setPdfDocProxy(null);
      setCurrentPdfPageNum(1);
      setPdfTotalPages(0);
      setPdfPageImage(null);
      setPdfPageIsTextBased(true);
      setIsRenderingPdfPage(false);
      setIsPerformingOcr(false);

      if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
      setDisplayedImageSrc(null);

      setTxtContent("");
      setCurrentTextForTTS("");
      setDocErrorMessage(null);
      setIsLoadingDoc(true);
      stopSpeech(true);

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

      if (!docIdToLoad) {
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
          await IndexedDBService.saveLastActiveDocId(null);
          setIsLoadingDoc(false);
          console.log(`[ReaderPage] loadDocumentMetadata: Document "${docIdToLoad}" not found in DB.`);
          return;
        }
        
        console.log(`[ReaderPage] loadDocumentMetadata: Document "${docIdToLoad}" found. Type: ${doc.type}. Setting activeDoc.`);
        setActiveDoc(doc as ActiveMangaDocument); 
        await IndexedDBService.saveLastActiveDocId(docIdToLoad);
        
        // setIsLoadingDoc(false) is handled by type-specific loaders or EPUB effect.
        // Set initial placeholder text for currentTextForTTS based on type
        if (doc.type === 'pdf') setCurrentTextForTTS("Loading PDF...");
        else if (doc.type === 'image') setCurrentTextForTTS("Loading image...");
        else if (doc.type === 'txt') setCurrentTextForTTS("Loading text file...");
        else if (doc.type === 'epub') setCurrentTextForTTS("Loading EPUB..."); // EPUB will also be handled by its own effect
        else if (doc.type === 'mobi') {
            setDocErrorMessage("MOBI file format is not directly supported for reading. Please convert it to EPUB or PDF.");
            setCurrentTextForTTS("MOBI files cannot be read directly. Please convert to a supported format like EPUB or PDF.");
            setIsLoadingDoc(false); // Set loading false for MOBI as it won't proceed further
        }


      } catch (err: any) {
        console.error("[ReaderPage] loadDocumentMetadata: Error loading document from IndexedDB:", err);
        setDocErrorMessage(`Error loading document: ${err.message}`);
        setCurrentTextForTTS(`Error loading document: ${err.message}`);
        setIsLoadingDoc(false);
      }
    };

    loadDocumentMetadata();

    return () => {
      // General cleanup
      console.log("[ReaderPage] Main useEffect cleanup: Stopping speech and revoking image object URL if any.");
      stopSpeech(true);
      if (currentImageObjectUrlRef.current) { URL.revokeObjectURL(currentImageObjectUrlRef.current); currentImageObjectUrlRef.current = null; }
    };
  }, [searchParams, router, stopSpeech]);


  // Effect for PDF Loading
  useEffect(() => {
    if (activeDoc?.type === 'pdf' && activeDoc.fileData) {
      console.log("[ReaderPage PDF] activeDoc is PDF. Initializing PDF document proxy.");
      setIsLoadingDoc(true);
      getDocument({ data: activeDoc.fileData.slice(0) }).promise.then(pdf => {
        console.log("[ReaderPage PDF] PDF document proxy loaded. Total pages:", pdf.numPages);
        setPdfDocProxy(pdf);
        setPdfTotalPages(pdf.numPages);
        const savedPageIndex = LocalStorageService.loadCurrentPdfPageIndexForDoc(activeDoc.id);
        const pageToLoad = (savedPageIndex && savedPageIndex > 0 && savedPageIndex <= pdf.numPages) ? savedPageIndex : 1;
        setCurrentPdfPageNum(pageToLoad);
        console.log(`[ReaderPage PDF] Setting current PDF page to: ${pageToLoad}`);
        // setIsLoadingDoc(false) will be handled by page rendering effect
      }).catch(e => {
        console.error("[ReaderPage PDF] Error loading PDF document proxy:", e);
        setDocErrorMessage(`Failed to load PDF: ${e.message}`);
        setCurrentTextForTTS(`Failed to load PDF: ${e.message}`);
        setIsLoadingDoc(false);
      });
    } else if (activeDoc?.type !== 'pdf' && pdfDocProxy) {
        console.log("[ReaderPage PDF] activeDoc is no longer PDF. Clearing PDF proxy.");
        setPdfDocProxy(null); // Clear proxy if doc type changes
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
        }
        
        const pdfDoc = activeDoc as StoredPdfDocument;
        if (pdfDoc.ocrTextPerPage?.[currentPdfPageNum]) {
            console.log(`[ReaderPage PDF] Page ${currentPdfPageNum} has pre-existing OCR text.`);
            setCurrentTextForTTS(pdfDoc.ocrTextPerPage[currentPdfPageNum]);
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
        setIsLoadingDoc(false); // PDF page content loaded (image or text)
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


  // Effect for EPUB Loading and Rendering
  useEffect(() => {
    let currentRendition: Rendition | null = null;
    let currentBook: EpubBook | null = null;

    const initializeEpub = async () => {
      if (activeDoc?.type === 'epub' && activeDoc.fileData && epubViewerRef.current) {
        console.log("[ReaderPage EPUB] Initializing EPUB for doc:", activeDoc.id);
        setIsLoadingDoc(true);
        setCurrentTextForTTS("Loading EPUB...");
        setDocErrorMessage(null);

        // Clear previous rendition content and destroy old instance
        if (epubRenditionRef.current) {
          try {
            console.log("[ReaderPage EPUB] Destroying previous global epubRenditionRef.current");
            epubRenditionRef.current.destroy();
          } catch (e) {
            console.warn("[ReaderPage EPUB] Error destroying old epubRenditionRef.current:", e);
          }
        }
        epubViewerRef.current.innerHTML = ''; // Clear the container
        epubRenditionRef.current = null;
        epubBookRef.current = null;
        
        try {
          const ePubModule = await import('epubjs');
          const ePub = ePubModule.default;
          currentBook = ePub(activeDoc.fileData);
          await currentBook.ready;
          console.log("[ReaderPage EPUB] Book ready for doc:", activeDoc.id);
          
          if (epubViewerRef.current && activeDoc?.type === 'epub') { // Re-check after await
            currentRendition = currentBook.renderTo(epubViewerRef.current, {
              width: "100%",
              height: "100%",
              flow: "paginated", 
              spread: "none", // Single page view
            });
            console.log("[ReaderPage EPUB] Rendition created for doc:", activeDoc.id);

            currentRendition.on('displayed', async (section: any) => {
              console.log("[ReaderPage EPUB] Rendition 'displayed' event for doc:", activeDoc.id);
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
                console.log(`[ReaderPage EPUB] Extracted text length: ${text.length} for doc: ${activeDoc.id}`);
              } catch (textExtractError: any) { 
                console.error("[ReaderPage EPUB] Error extracting text from EPUB section:", textExtractError);
                setCurrentTextForTTS(`Error extracting text from EPUB: ${textExtractError.message}`);
              }
            });
            await currentRendition.display();
            epubRenditionRef.current = currentRendition; // Store the new rendition
            epubBookRef.current = currentBook;         // Store the new book
            console.log("[ReaderPage EPUB] Rendition displayed successfully for doc:", activeDoc.id);
          } else {
             console.warn("[ReaderPage EPUB] viewerElement or activeDoc became invalid during async EPUB initialization (after book.ready).");
             setDocErrorMessage("EPUB viewer element disappeared or document changed during loading.");
          }
        } catch (e: any) {
          console.error("[ReaderPage EPUB] Error during EPUB initialization:", e);
           const errorMsg = e instanceof Error ? e.message : String(e);
           let userFriendlyError = `Failed to load EPUB: ${errorMsg}`;
            if (errorMsg.toLowerCase().includes("uncompressed data size mismatch") || errorMsg.toLowerCase().includes("reading 'package'")) {
              userFriendlyError = `Failed to load EPUB: The file might be corrupted or not a valid EPUB. (Detail: ${errorMsg})`;
            } else if (errorMsg.toLowerCase().includes("cannot read properties of undefined (reading 'package')")){
              userFriendlyError = `Failed to load EPUB: Error initializing EPUB reader. The file might be incompatible. (Detail: ${errorMsg})`;
            }
          setDocErrorMessage(userFriendlyError);
          setCurrentTextForTTS(userFriendlyError);
          currentRendition = null; // Ensure it's null on error
          currentBook = null;
          if (epubViewerRef.current) epubViewerRef.current.innerHTML = ''; // Clear viewer on error
        } finally {
          setIsLoadingDoc(false);
          console.log("[ReaderPage EPUB] Finished EPUB initialization attempt for doc:", activeDoc?.id);
        }
      } else if (activeDoc?.type !== 'epub' && epubRenditionRef.current) {
        // If activeDoc is no longer EPUB, clean up the existing global rendition
        console.log("[ReaderPage EPUB] activeDoc is not EPUB. Destroying existing global rendition if any.");
        try {
          epubRenditionRef.current.destroy();
        } catch (e) {
          console.warn("[ReaderPage EPUB] Error destroying global epubRenditionRef.current in non-EPUB case:", e);
        }
        if (epubViewerRef.current) epubViewerRef.current.innerHTML = '';
        epubRenditionRef.current = null;
        epubBookRef.current = null;
        setIsLoadingDoc(false); // Ensure loading is false if we switch away from EPUB
      } else {
         // If it's not an EPUB, or viewer not ready, or no file data.
         // Ensure loading is false if we are not proceeding with EPUB load.
         if(activeDoc && activeDoc.type === 'epub' && !isLoadingDoc) {
            // This case means it's an EPUB but something is not ready (e.g. viewerRef)
            // We should ideally show a message or retry, for now, ensure loading is false
            // if it was not set by other document types.
         } else if (!activeDoc) {
           // If there's no activeDoc at all, this effect shouldn't do much,
           // but ensure loading is false if it hasn't been set by others.
           // setIsLoadingDoc(false); // This might be too broad, initial loadDocument handles this.
         }
      }
    };

    initializeEpub();

    return () => {
      // Cleanup for the specific rendition created in *this* effect run
      if (currentRendition) {
        console.log("[ReaderPage EPUB] Cleanup: Destroying currentRendition for doc:", activeDoc?.id);
        try {
          currentRendition.destroy();
        } catch (e) {
          console.warn("[ReaderPage EPUB] Error during currentRendition.destroy() in cleanup:", e);
        }
      }
    };
  }, [activeDoc]); // Depends on activeDoc. epubViewerRef.current is checked inside.


  // Effect for TXT file loading
  useEffect(() => {
    if (activeDoc?.type === 'txt' && activeDoc.fileData) {
        console.log("[ReaderPage TXT] activeDoc is TXT. Decoding file data.");
        setIsLoadingDoc(true);
        setCurrentTextForTTS("Loading text file...");
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
    } else {
        setTxtContent(""); 
    }
  }, [activeDoc]);

  // Effect for Image file loading
  useEffect(() => {
    if (activeDoc?.type === 'image' && activeDoc.fileData) {
        console.log("[ReaderPage Image] activeDoc is Image. Creating object URL.");
        setIsLoadingDoc(true);
        setCurrentTextForTTS("Loading image...");
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
    } else {
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
    const currentActiveDoc = activeDoc; 

    if (currentActiveDoc.type === 'pdf' && pdfPageImage && !pdfPageIsTextBased) {
        dataUrlToProcess = pdfPageImage;
        console.log("[ReaderPage OCR] Using current PDF page image for OCR.");
    } else if (currentActiveDoc.type === 'image' && currentActiveDoc.fileData) {
        console.log("[ReaderPage OCR] Preparing image document for OCR.");
        try {
            // Fetch fresh doc data to ensure it's the latest, though activeDoc should be up-to-date
            const docToProcess = await IndexedDBService.getDocumentById(currentActiveDoc.id);
            if (!docToProcess || !docToProcess.fileData || !docToProcess.originalType) {
                toast({variant: "destructive", title: "OCR Error", description: "Image data or type is missing for OCR."});
                setIsPerformingOcr(false);
                console.error("[ReaderPage OCR] Image data or type missing from fetched doc.");
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
        console.warn("[ReaderPage OCR] No dataUrlToProcess for OCR.");
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
                const ocrPages = { ...(currentActiveDoc as StoredPdfDocument).ocrTextPerPage, [currentPdfPageNum]: ocrText };
                (updatedDocFields as Partial<StoredPdfDocument>).ocrTextPerPage = ocrPages;
            }
            
            const newActiveDocState = { ...currentActiveDoc, ...updatedDocFields } as ActiveMangaDocument;
            await IndexedDBService.saveDocument(newActiveDocState);
            setActiveDoc(newActiveDocState); // Update activeDoc state with new OCR text
            console.log("[ReaderPage OCR] Updated document saved to IndexedDB and activeDoc state updated.");

        } else {
            setCurrentTextForTTS(`OCR Error: ${result.error}`);
            toast({ variant: "destructive", title: "OCR Error", description: result.error });
            console.error(`[ReaderPage OCR] OCR action returned error: ${result.error}`);
        }
    } catch (e: any) {
        console.error("[ReaderPage OCR] Detailed OCR error from server action:", e);
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
    let settingsToSave = { ...ttsSettings };
    let changesMadeToSettingsState = false;

    if (typeof window !== 'undefined' && window.speechSynthesis && settingsToSave.engine === 'local') {
        const systemVoices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService, default: v.default }));

        if (systemVoices.length > 0) {
            let voiceToSet: TTSVoice | undefined = settingsToSave.voiceURI ? systemVoices.find(v => v.voiceURI === settingsToSave.voiceURI) : undefined;
            let langToSet = settingsToSave.language;

            const currentVoiceIsValidForLanguage = voiceToSet && voiceToSet.lang && voiceToSet.lang.startsWith(settingsToSave.language.split('-')[0]);

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
            }
            if (langToSet && langToSet !== settingsToSave.language) {
                settingsToSave.language = langToSet;
                changesMadeToSettingsState = true;
            }
        } else { 
             if(settingsToSave.voiceURI !== undefined) {
                settingsToSave.voiceURI = undefined;
                changesMadeToSettingsState = true;
             }
        }
    } else if (settingsToSave.engine === 'cloud') {
        if (settingsToSave.voiceURI !== undefined) { 
            settingsToSave.voiceURI = undefined;
            changesMadeToSettingsState = true;
        }
    }

    if (changesMadeToSettingsState) {
        setTtsSettings(settingsToSave); 
    }
    LocalStorageService.saveTTSSettings(settingsToSave); 

}, [ttsSettings.engine, ttsSettings.language, ttsSettings.voiceURI, availableVoices, ttsSettings.rate, ttsSettings.pitch]); 


  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;

    const handleAudioEnded = () => { if (audioPlayerRef.current === player && isSpeaking && ttsSettings.engine === 'cloud') stopSpeech(true); };
    const handleAudioPlaying = () => { if (audioPlayerRef.current === player && ttsSettings.engine === 'cloud' && isSpeaking) setIsLoadingTTS(false); };
    const handleAudioError = (e: Event) => { if (audioPlayerRef.current === player && isSpeaking && ttsSettings.engine === 'cloud') { toast({variant: "destructive", title: "Audio Error", description: "Failed to play cloud TTS audio."}); console.error("Cloud TTS Audio Error:", e); stopSpeech(true); }};

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
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    const selectedTextFromSelection = selection?.toString().trim();
    const effectiveTextToRead = selectedTextFromSelection || currentTextForTTS;

    const invalidMessages = [
      "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...",
      "Image loaded. Perform OCR", "No text content found", "Could not extract text",
      "EPUB viewer element not ready", "EPUB section loaded, but text extraction",
      "This PDF page has no selectable text", "MOBI files cannot be read directly.",
      "This PDF page seems to be an image. Use OCR to extract text.",
      "Performing OCR...", "No document ID provided", "Document with ID",
       "EPUB viewer element is not available in the DOM yet",
      "EPUB viewer element not ready", "MOBI file format is not directly supported",
      "OCR completed, but no text found.",
      "No document selected.", "No document selected and no previously active document found."
    ];

    if (!effectiveTextToRead || invalidMessages.some(msg => effectiveTextToRead.startsWith(msg)) || effectiveTextToRead.length < MIN_TTS_TEXT_LENGTH) {
      toast({ variant: "destructive", title: "No Valid Text", description: `No valid text to read, text is placeholder, or text too short (min ${MIN_TTS_TEXT_LENGTH} chars). Current text: "${effectiveTextToRead.substring(0,50)}..."` });
      return;
    }

    if (isSpeaking) {
      if (isPaused) {
        if (ttsSettings.engine === 'local' && utteranceRef.current && window.speechSynthesis?.paused) { window.speechSynthesis.resume(); setIsPaused(false); }
        else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current?.paused) { audioPlayerRef.current.play().catch(() => stopSpeech(true)); setIsPaused(false); }
      } else {
        if (ttsSettings.engine === 'local' && utteranceRef.current && window.speechSynthesis?.speaking) { window.speechSynthesis.pause(); setIsPaused(true); }
        else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current && !audioPlayerRef.current.paused) { audioPlayerRef.current.pause(); setIsPaused(true); }
      }
    } else {
      stopSpeech(false); 
      setIsLoadingTTS(true);
      setIsSpeaking(true);
      setIsPaused(false);

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
                voiceToUse = systemVoices.find(v => v.default && v.lang) || systemVoices[0];
            }
        }

        if (voiceToUse) {
          utterance.voice = voiceToUse;
        } else if (availableVoices.length === 0 && systemVoices.length === 0) {
          toast({variant: "destructive", title: "TTS Error", description: "No speech synthesis voices available in this browser."}); stopSpeech(true); return;
        }
        
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
    const invalidMessages = [
      "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...",
      "Image loaded. Perform OCR", "No text content found", "Could not extract text",
      "EPUB viewer element not ready", "EPUB section loaded, but text extraction",
      "This PDF page has no selectable text", "MOBI files cannot be read directly.",
      "This PDF page seems to be an image. Use OCR to extract text.",
      "Performing OCR...", "No document ID provided", "Document with ID",
       "EPUB viewer element is not available in the DOM yet",
      "EPUB viewer element not ready", "MOBI file format is not directly supported",
      "OCR completed, but no text found.",
      "No document selected.", "No document selected and no previously active document found."
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
      "Error:", "Failed to load", "Loading PDF page...", "MOBI files cannot", "Loading EPUB...", "Loading text file...", "Loading image...",
      "Image loaded. Perform OCR", "No text content found", "Could not extract text",
      "EPUB viewer element not ready", "EPUB section loaded, but text extraction",
      "This PDF page has no selectable text", "MOBI files cannot be read directly.",
      "This PDF page seems to be an image. Use OCR to extract text.",
      "Performing OCR...", "No document ID provided", "Document with ID",
       "EPUB viewer element is not available in the DOM yet",
      "EPUB viewer element not ready", "MOBI file format is not directly supported",
      "OCR completed, but no text found.",
      "No document selected.", "No document selected and no previously active document found."
    ];
    const canPlay = !!(effectiveText && !invalidMessages.some(msg => effectiveText.startsWith(msg)) && effectiveText.length >= MIN_TTS_TEXT_LENGTH && activeDoc && !isLoadingDoc && !isPerformingOcr && !isRenderingPdfPage);

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

  const showOcrButtonForPdfPage = activeDoc?.type === 'pdf' && !pdfPageIsTextBased && pdfPageImage && !isRenderingPdfPage && !isLoadingDoc;
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

        {isLoadingDoc && (!activeDoc || (activeDoc && (activeDoc.type === 'epub' || activeDoc.type === 'pdf' || activeDoc.type === 'image' || activeDoc.type === 'txt'))) && <div className="flex items-center justify-center h-full"><Loader2 className="h-10 w-10 animate-spin text-primary" /><p className="ml-3">Loading content...</p></div>}


        {!isLoadingDoc && activeDoc?.type === 'pdf' && (
          <div className="flex flex-col items-center">
            {isRenderingPdfPage && !pdfPageImage && <Loader2 className="h-10 w-10 animate-spin my-8" />}
            {pdfPageImage && <NextImage src={pdfPageImage} alt={`Page ${currentPdfPageNum}`} width={0} height={0} sizes="100vw" style={{ width: 'auto', height: 'auto', maxHeight: 'calc(100vh - 12rem)', maxWidth: '100%', objectFit: 'contain' }} className="shadow-lg border rounded-md" />}
            {!pdfPageImage && !isRenderingPdfPage && !docErrorMessage && (pdfDocProxy && pdfTotalPages > 0) && <div className="my-8 text-muted-foreground">{`Rendering page ${currentPdfPageNum}...`}</div>}
             {showOcrButtonForPdfPage && (
                <Button onClick={handlePerformOcr} disabled={isPerformingOcr} className="mt-3">
                    {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />} Perform OCR on PDF Page
                </Button>
            )}
          </div>
        )}
        {!isLoadingDoc && activeDoc?.type === 'epub' && (
          <div ref={epubViewerRef} className={cn("w-full h-full epub-viewer-container bg-background rounded-md shadow-inner", (isLoadingDoc || (!epubRenditionRef.current && !docErrorMessage && activeDoc?.type === 'epub')) && "opacity-50 flex items-center justify-center")}>
             {(isLoadingDoc || (!epubRenditionRef.current && !docErrorMessage && activeDoc?.type === 'epub' && !viewerMightBeReadyForEpub())) && <Loader2 className="h-10 w-10 animate-spin" />}
             {/* The viewer element is present, EPUB effect will handle loading indicator via isLoadingDoc */}
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
                {activeDoc && <CardDescription className="text-xs">Type: {activeDoc.type.toUpperCase()}{activeDoc.type === 'pdf' && pdfTotalPages > 0 ? `, ${currentPdfPageNum}/${pdfTotalPages} pages` : ''}{activeDoc.type === 'epub' && (isLoadingDoc || (!epubRenditionRef.current && !docErrorMessage && activeDoc?.type === 'epub')) ? ` (Loading EPUB...)`: ''}</CardDescription>}
                 {!activeDoc && !isLoadingDoc && !docErrorMessage && <CardDescription className="text-xs">No document loaded. Select one from the library or refresh if one was previously active.</CardDescription>}
                 {docErrorMessage && <CardDescription className="text-xs text-destructive">{docErrorMessage}</CardDescription>}

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
              <Select value={ttsSettings.engine} onValueChange={(v) => handleSettingChange('engine', v as 'local' | 'cloud')} disabled={(isSpeaking && !isPaused) || isLoadingDoc}>
                <SelectTrigger id="tts-engine" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="local"><div className="flex items-center gap-1 text-xs"><Smartphone className="h-3 w-3"/>Local</div></SelectItem><SelectItem value="cloud"><div className="flex items-center gap-1 text-xs"><CloudIcon className="h-3 w-3"/>Cloud</div></SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tts-language" className="text-xs">Language</Label>
              <Input id="tts-language" className="h-9 text-xs" value={ttsSettings.language} onChange={(e) => handleSettingChange('language', e.target.value)} disabled={(isSpeaking && !isPaused) || (ttsSettings.engine === 'local' && availableVoices.length === 0) || isLoadingDoc} />
            </div>
            {ttsSettings.engine === 'local' && (
              <div>
                <Label htmlFor="tts-voice" className="text-xs">Voice (Local)</Label>
                <Select value={ttsSettings.voiceURI || ""} onValueChange={(v) => handleSettingChange('voiceURI', v)} disabled={(isSpeaking && !isPaused) || availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 || isLoadingDoc}>
                  <SelectTrigger id="tts-voice" className="h-9 text-xs"><SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No voices available"} /></SelectTrigger>
                  <SelectContent className="max-h-48">
                    {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).map(v => (<SelectItem key={v.voiceURI || v.name} value={v.voiceURI || ""} className="text-xs">{v.name} ({v.lang})</SelectItem>))}
                    {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (<SelectItem value="no-voice-reader" disabled className="text-xs">{availableVoices.length > 0 ? "No voices for language" : "No local voices"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1"><Label htmlFor="tts-rate" className="text-xs">Rate: {ttsSettings.rate.toFixed(1)}</Label><Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={(isSpeaking && !isPaused) || isLoadingDoc}/></div>
            <div className="space-y-1"><Label htmlFor="tts-pitch" className="text-xs">Pitch: {ttsSettings.pitch.toFixed(1)}</Label><Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={(isSpeaking && !isPaused) || isLoadingDoc}/></div>
            <Button onClick={playPauseSpeech} disabled={buttonState.disabled} variant={isSpeaking && !isPaused ? "outline" : "default"} className="w-full h-9 text-sm">{buttonState.icon} {buttonState.text}</Button>
            <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="w-full mt-2 text-xs" disabled={!activeDoc || isLoadingDoc || isPerformingOcr}><Star className="mr-2 h-3 w-3" /> Favorite Text/Selection</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
    
 // Helper function to determine if the EPUB viewer div might be ready
 // This is a heuristic and might need adjustment based on rendering logic
 function viewerMightBeReadyForEpub(): boolean {
    // This function is a placeholder. In a real scenario, you might check
    // if the specific conditions for the epubViewerRef's container to render are met.
    // For now, it assumes if we are trying to load an EPUB, the JSX structure for it exists.
    return true; 
 }
