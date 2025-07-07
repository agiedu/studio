
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import NextImage from 'next/image';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdf-dist/types/src/display/api';
import type Book from 'epubjs/types/book';
import type Rendition from 'epubjs/types/rendition';


import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Loader2, Play, Pause, Smartphone, Cloud as CloudIcon, Star, AlertTriangle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, BookOpen, Settings2, FileText, ScanText, Trash2, Edit, Repeat, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";


import { getCloudSpeech, performOCR } from '@/app/actions';
import * as LocalStorageService from '@/lib/localStorageService';
import * as IndexedDBService from '@/lib/indexedDBService';
import type { TTSSettings, TTSVoice, StoredMangaDocument, ActiveMangaDocument, StoredPdfDocument, StoredImageDocument, StoredEpubDocument, StoredTxtDocument, StoredMobiDocument } from '@/types';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';

const PDF_DEFAULT_SCALE = 1.0;
const PUNCTUATION_REGEX = /\p{P}/gu;

type SpeechOrigin = 'main' | 'repeat' | null;

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
  const [isPdfTextView, setIsPdfTextView] = useState(false);
  const [pdfTextContent, setPdfTextContent] = useState<string | null>(null);


  // EPUB specific states and refs
  const epubViewerRef = useRef<HTMLDivElement | null>(null);
  const epubBookRef = useRef<Book | null>(null);
  const epubRenditionRef = useRef<Rendition | null>(null);
  const [isEpubLoading, setIsEpubLoading] = useState(false);
  const [epubPageIsImage, setEpubPageIsImage] = useState(false);
  const epubImageForOcrRef = useRef<string | null>(null);
  const [epubTotalPages, setEpubTotalPages] = useState(0);
  const [epubCurrentPageNum, setEpubCurrentPageNum] = useState(0);
  const [isEpubPaginating, setIsEpubPaginating] = useState(false);


  // TXT and Image states
  const [txtContent, setTxtContent] = useState<string>("");
  const [displayedImageSrc, setDisplayedImageSrc] = useState<string | null>(null);
  const currentImageObjectUrlRef = useRef<string | null>(null);
  
  // Scratchpad state
  const [scratchpadText, setScratchpadText] = useState<string>(LocalStorageService.loadScratchpadText());
  const scrollPositionRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // OCR and TTS states
  const [isPerformingOcr, setIsPerformingOcr] = useState(false);
  const [currentTextForTTS, setCurrentTextForTTS] = useState<string>("");
  const [ttsSettings, setTtsSettings] = useState<TTSSettings>(LocalStorageService.defaultTTSSettings);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);
  const [isLoadingTTS, setIsLoadingTTS] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speechOrigin, setSpeechOrigin] = useState<SpeechOrigin>(null);
  const [highlightedSegmentIndex, setHighlightedSegmentIndex] = useState<number>(-1);


  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const mainHighlightedContentRef = useRef<HTMLDivElement | null>(null);
  const ttsBoxHighlightedContentRef = useRef<HTMLDivElement | null>(null);


  const isMountedRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const segmentIndexRef = useRef(0);
  const selectionInfoRef = useRef<{ text: string; startIndex: number | null } | null>(null);

  // Refs for text selection
  const mainTextAreaRef = useRef<HTMLTextAreaElement | null>(null); // For Scratchpad
  const ttsBoxTextAreaRef = useRef<HTMLTextAreaElement | null>(null); // For the box at the bottom

  // Jump to page dialog state
  const [jumpDialogInfo, setJumpDialogInfo] = useState<{
    open: boolean;
    type: 'pdf' | 'epub' | null;
    currentPage: number;
    totalPages: number;
  }>({ open: false, type: null, currentPage: 0, totalPages: 0 });
  const [jumpToPageInput, setJumpToPageInput] = useState("");


  const textSegments = useMemo(() => {
    if (!currentTextForTTS) return [];
    // Split by common sentence-ending punctuation, keeping the delimiter.
    // This regex handles English and Chinese punctuation.
    const parts = currentTextForTTS.split(/([.?!,。？！，、\n]+)/g);
    const segments = [];
    // Reassemble parts to ensure delimiters are attached to the preceding text segment
    for (let i = 0; i < parts.length; i += 2) {
      const text = parts[i];
      const delimiter = parts[i + 1] || '';
      if (text || delimiter) {
        segments.push(text + delimiter);
      }
    }
    return segments.filter(s => s.length > 0);
  }, [currentTextForTTS]);

  const speakingViewContent = useMemo(() => {
    if (!isSpeaking && !isPaused) return null;
    if (highlightedSegmentIndex < 0 || !textSegments[highlightedSegmentIndex]) {
      return currentTextForTTS;
    }

    const preText = textSegments.slice(0, highlightedSegmentIndex).join('');
    const highlightedText = textSegments[highlightedSegmentIndex];
    const postText = textSegments.slice(highlightedSegmentIndex + 1).join('');

    return (
      <>
        {preText}
        <span className="text-primary">{highlightedText}</span>
        {postText}
      </>
    );
  }, [isSpeaking, isPaused, highlightedSegmentIndex, textSegments, currentTextForTTS]);


  const getSelectedText = useCallback((): { text: string; startIndex: number | null } => {
    if (typeof window === 'undefined') {
      return { text: '', startIndex: null };
    }
  
    // Helper function to calculate start index from a selection and a container
    // It's robust and finds the precise character index of the selection start.
    const getIndexFromSelection = (selection: Selection, container: HTMLElement): { text: string, startIndex: number } | null => {
        if (!selection.rangeCount || selection.isCollapsed) return null;

        const range = selection.getRangeAt(0);
        // Ensure the selection is actually within the designated container
        if (!container.contains(range.startContainer)) return null;

        const selectionText = range.toString();

        const preSelectionRange = range.cloneRange();
        preSelectionRange.selectNodeContents(container);
        preSelectionRange.setEnd(range.startContainer, range.startOffset);
        const startIndex = preSelectionRange.toString().length;

        return { text: selectionText, startIndex };
    };

    // Priority 1: Textareas (most reliable via selectionStart)
    const mainTextarea = mainTextAreaRef.current;
    if (mainTextarea && mainTextarea.selectionStart !== mainTextarea.selectionEnd) {
      return {
        text: mainTextarea.value.substring(mainTextarea.selectionStart, mainTextarea.selectionEnd),
        startIndex: mainTextarea.selectionStart
      };
    }
    const ttsTextarea = ttsBoxTextAreaRef.current;
    if (ttsTextarea && ttsTextarea.selectionStart !== ttsTextarea.selectionEnd) {
      return {
        text: ttsTextarea.value.substring(ttsTextarea.selectionStart, ttsTextarea.selectionEnd),
        startIndex: ttsTextarea.selectionStart
      };
    }
  
    // Priority 2: EPUB iframe (now uses robust index calculation)
    if (activeDoc?.type === 'epub' && epubRenditionRef.current) {
      try {
        const epubWindow = epubRenditionRef.current.getContents()?.[0]?.window;
        if (epubWindow) {
            const selection = epubWindow.getSelection();
            if (selection) {
                const result = getIndexFromSelection(selection, epubWindow.document.body);
                if (result) return result;
            }
        }
      } catch (e) {
        console.warn("Could not get selection from EPUB iframe", e);
      }
    }
    
    // Priority 3: General page selection (e.g., in the main display divs)
    const pageSelection = window.getSelection();
    if (pageSelection && !pageSelection.isCollapsed) {
        const scrollContainer = scrollContainerRef.current;
        if (scrollContainer) {
            const result = getIndexFromSelection(pageSelection, scrollContainer);
            if(result) return result;
        }

        const ttsContainer = ttsBoxHighlightedContentRef.current;
        if (ttsContainer) {
            const result = getIndexFromSelection(pageSelection, ttsContainer);
            if(result) return result;
        }

        return { text: pageSelection.toString(), startIndex: null };
    }
  
    return { text: '', startIndex: null };
  }, [activeDoc?.type]);


  useEffect(() => {
    isMountedRef.current = true;
    if (typeof window !== 'undefined') {
      try {
        GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url
        ).toString();
      } catch (error) {
        console.error("Failed to set pdf.js worker source:", error);
      }
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

  // Effect to restore scroll position when switching to speaking view to prevent jump-to-top
  useEffect(() => {
    if (isSpeaking && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollPositionRef.current;
    }
  }, [isSpeaking])


  const stopSpeech = useCallback((resetUIState = true) => {
    isSpeakingRef.current = false;
    if (isMountedRef.current) {
        setHighlightedSegmentIndex(-1);
    }
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

  const updateOcrSourceFromImage = useCallback((imageElement: HTMLImageElement) => {
    if (!isMountedRef.current) return;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = imageElement.naturalWidth;
        canvas.height = imageElement.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(imageElement, 0, 0);
            epubImageForOcrRef.current = canvas.toDataURL('image/png');
            setCurrentTextForTTS("This page is an image. Use OCR to extract text.");
        } else {
            throw new Error("Could not get canvas context.");
        }
    } catch (e) {
        console.error("Error creating OCR source from image:", e);
        epubImageForOcrRef.current = null;
        setCurrentTextForTTS("Could not prepare image for OCR.");
    } finally {
        if (isMountedRef.current) {
            setEpubPageIsImage(true);
        }
    }
  }, []);

  const processEpubView = useCallback(async (view: any) => {
    if (!isMountedRef.current || !view?.document?.body) {
        return;
    }

    try {
        const contentBody = view.document.body;
        const imageElement = contentBody.querySelector('img') || contentBody.querySelector('image');

        if (imageElement) { // If an image exists, we prioritize it for OCR.
            imageElement.crossOrigin = "anonymous";
            // Check if image is loaded and has dimensions.
            if (imageElement.complete && imageElement.naturalWidth > 0) {
                updateOcrSourceFromImage(imageElement);
            } else {
                setCurrentTextForTTS("Loading image for OCR...");
                setEpubPageIsImage(true); // Show OCR button while image loads
                imageElement.onload = () => updateOcrSourceFromImage(imageElement);
                imageElement.onerror = () => {
                    if (!isMountedRef.current) return;
                    epubImageForOcrRef.current = null;
                    const pageText = (contentBody.innerText || "").trim();
                    setCurrentTextForTTS(pageText || "Could not load image. No fallback text found.");
                    setEpubPageIsImage(false);
                };
            }
        } else { // No image found, fall back to text content.
            epubImageForOcrRef.current = null;
            const pageText = (contentBody.innerText || "").trim();
            if (isMountedRef.current) {
                setCurrentTextForTTS(pageText || "This page has no text or image content.");
                setEpubPageIsImage(false);
            }
        }
    } catch (error) {
        console.error("Error processing EPUB view:", error);
        if (isMountedRef.current) {
            setCurrentTextForTTS("Error analyzing page content.");
            setEpubPageIsImage(false); // Reset state on error
        }
    }
  }, [updateOcrSourceFromImage]);

  // Main Effect for loading and cleaning up any document type
  useEffect(() => {
    const docId = searchParams.get('docId');
    let isStale = false;
    
    const cleanup = () => {
      console.log("[Cleanup] Running cleanup for previous document.");
      stopSpeech(true);
      if (pdfDocProxy) {
        try { pdfDocProxy.destroy(); } catch (e) { console.log("Non-critical error destroying PDF proxy", e); }
        setPdfDocProxy(null);
      }
      setPdfTextContent(null);
      setIsPdfTextView(false);
      
      if (currentImageObjectUrlRef.current) {
        URL.revokeObjectURL(currentImageObjectUrlRef.current);
        currentImageObjectUrlRef.current = null;
      }
      
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
      setEpubPageIsImage(false);
      epubImageForOcrRef.current = null;
      setEpubTotalPages(0);
      setEpubCurrentPageNum(0);
      setIsEpubPaginating(false);
    };

    const loadDocument = async () => {
      if (!docId) {
        const lastActiveId = await IndexedDBService.getLastActiveDocId();
        if (isStale) return;
        if (lastActiveId) {
            router.replace(`/reader?docId=${lastActiveId}`, { scroll: false }); 
        } else {
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
        
        switch (doc.type) {
          case 'pdf':
            setIsLoadingDoc(true);
            try {
              const pdf = await getDocument({ data: doc.fileData.slice(0) }).promise;
              if (isStale) { try { pdf.destroy(); } catch(e){} return; }

              const pagePromises = [];
              for (let i = 1; i <= pdf.numPages; i++) {
                pagePromises.push(
                  pdf.getPage(i).then(page => 
                    page.getTextContent().then(textContent => {
                      page.cleanup();
                      return textContent.items.map(item => ('str' in item ? item.str : '')).join(' ');
                    })
                  )
                );
              }
              const pageTexts = await Promise.all(pagePromises);
              const allText = pageTexts.join('\n\n').trim();

              if (isStale) { pdf.destroy(); return; }

              if (allText.length > 0) {
                setPdfTextContent(allText);
                setCurrentTextForTTS(allText);
                setIsPdfTextView(true);
                pdf.destroy(); 
              } else {
                setIsPdfTextView(false);
                setPdfDocProxy(pdf);
                setPdfTotalPages(pdf.numPages);
                const savedPageIndex = LocalStorageService.loadCurrentPdfPageIndexForDoc(doc.id);
                setCurrentPdfPageNum((savedPageIndex > 0 && savedPageIndex <= pdf.numPages) ? savedPageIndex : 1);
              }
            } catch (pdfError: any) {
              if (isStale) return;
              console.error("Error processing PDF:", pdfError);
              setDocErrorMessage(`Error processing PDF: ${pdfError.message}`);
            } finally {
              if (isMountedRef.current) setIsLoadingDoc(false);
            }
            break;
          
            case 'epub':
              setIsEpubLoading(true);
              try {
                  const ePubModule = await import('epubjs');
                  const ePub = (ePubModule as any).default || ePubModule;
                  if (!ePub) throw new Error("ePub.js module could not be loaded correctly.");
                  
                  const book = ePub(doc.fileData);
                  epubBookRef.current = book;
            
                  if (isStale) { book.destroy(); return; }
                  
                  if (!epubViewerRef.current) throw new Error("EPUB viewer element not ready.");
            
                  const rendition = book.renderTo(epubViewerRef.current, { width: "100%", height: "100%", flow: "paginated", spread: "none" });
                  epubRenditionRef.current = rendition;

                  const onRelocated = (location: any) => {
                    if (!isMountedRef.current || !epubRenditionRef.current) return;
                    try {
                      if (activeDoc?.id) {
                          LocalStorageService.saveCurrentEpubCfiForDoc(activeDoc.id, location.start.cfi);
                      }
                      if (epubBookRef.current?.locations && typeof epubBookRef.current.locations.pageFromCfi === 'function') {
                        const currentPage = epubBookRef.current.locations.pageFromCfi(location.start.cfi);
                        setEpubCurrentPageNum(currentPage);
                      }
                      processEpubView(rendition.getContents()?.[0]);
                    } catch (e) {
                       console.warn("Error in onRelocated (safe to ignore):", e);
                    }
                  };

                  rendition.on('rendered', (section: any, view: any) => {
                      if (!isMountedRef.current) return;
                      processEpubView(view);
                  });
                  
                  rendition.on('relocated', onRelocated);

                  const lastLocation = LocalStorageService.loadCurrentEpubCfiForDoc(doc.id); 
                  await rendition.display(lastLocation || undefined);

                  // Start pagination in the background
                  setIsEpubPaginating(true);
                  book.locations.generate(1650).then((generatedLocations) => {
                      if (!isMountedRef.current || !book || !epubRenditionRef.current) return;
                      
                      // Now that locations are generated, we can set the total pages.
                      if (generatedLocations) {
                        setEpubTotalPages(generatedLocations.length);
                      }
                      
                      // Re-sync current page number after locations are ready.
                      const currentLocation = epubRenditionRef.current.currentLocation();
                      if (currentLocation?.start?.cfi && book.locations && typeof book.locations.pageFromCfi === 'function') {
                        const cfi = currentLocation.start.cfi;
                        const currentPageNum = book.locations.pageFromCfi(cfi);
                        setEpubCurrentPageNum(currentPageNum);
                      }
                      
                      setIsEpubPaginating(false);
                  }).catch(err => {
                      console.error("Error generating EPUB locations:", err);
                      if(isMountedRef.current) setIsEpubPaginating(false);
                  });

                  if (isStale) return;
            
              } catch (e: any) {
                  if (isStale) return;
                  console.error("Error processing EPUB:", e);
                  setDocErrorMessage(`Error processing EPUB: ${e.message}`);
              } finally {
                  if (isMountedRef.current) {
                      setIsEpubLoading(false);
                      setIsLoadingDoc(false);
                  }
              }
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
  }, [searchParams, router, processEpubView, stopSpeech]);


  // PDF Page Rendering Effect
  useEffect(() => {
    if (activeDoc?.type !== 'pdf' || isPdfTextView || !pdfDocProxy || !currentPdfPageNum) return;

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
  }, [pdfDocProxy, currentPdfPageNum, pdfScale, activeDoc, isPdfTextView, stopSpeech]);


  const handlePerformOcr = useCallback(async () => {
    if (!activeDoc) {
      toast({ variant: 'destructive', title: 'OCR Error', description: 'No active document.' });
      return;
    }
    if (!isMountedRef.current) return;
    stopSpeech(true);
    setIsPerformingOcr(true);
    setCurrentTextForTTS('Performing OCR...');

    try {
      let dataUrlToProcess: string | null = null;
      const currentActiveDoc = activeDoc;

      if (currentActiveDoc.type === 'pdf' && pdfPageImage && !pdfPageIsTextBased) {
        dataUrlToProcess = pdfPageImage;
      } else if (currentActiveDoc.type === 'image' && currentActiveDoc.fileData) {
        const docToProcess = await IndexedDBService.getDocumentById(currentActiveDoc.id) as StoredImageDocument | null;
        if (!docToProcess || !docToProcess.fileData || !docToProcess.originalType) throw new Error('Image data missing from IndexedDB.');
        dataUrlToProcess = await IndexedDBService.arrayBufferToBase64DataURL(docToProcess.fileData, docToProcess.originalType);
      } else if (currentActiveDoc.type === 'epub' && epubPageIsImage) {
        dataUrlToProcess = epubImageForOcrRef.current;
        if (!dataUrlToProcess) {
          throw new Error('EPUB image source for OCR is missing.');
        }
      }

      if (!dataUrlToProcess) {
        throw new Error('No image data available for OCR.');
      }

      const result = await performOCR(dataUrlToProcess);
      if (!isMountedRef.current) return;

      if ('extractedText' in result) {
        const ocrText = result.extractedText || 'OCR completed, no text found.';
        setCurrentTextForTTS(ocrText);
        toast({ title: 'OCR Successful', description: 'Text extracted.' });

        if (currentActiveDoc.type === 'pdf' || currentActiveDoc.type === 'image') {
          const docFromDB = await IndexedDBService.getDocumentById(currentActiveDoc.id);
          if (docFromDB) {
            let updatedDocForSave: StoredMangaDocument = { ...docFromDB };
            if (updatedDocForSave.type === 'image') {
              (updatedDocForSave as StoredImageDocument).extractedText = ocrText;
            } else if (updatedDocForSave.type === 'pdf' && currentPdfPageNum) {
              const ocrPages = { ...((updatedDocForSave as StoredPdfDocument).ocrTextPerPage || {}), [currentPdfPageNum]: ocrText };
              (updatedDocForSave as StoredPdfDocument).ocrTextPerPage = ocrPages;
              if (isMountedRef.current) setPdfPageIsTextBased(false);
            }
            await IndexedDBService.saveDocument(updatedDocForSave);
            if (isMountedRef.current && activeDoc?.id === updatedDocForSave.id) {
              setActiveDoc(updatedDocForSave as ActiveMangaDocument);
            }
          }
        }
      } else {
        throw new Error(result.error || 'OCR failed with an unknown error.');
      }
    } catch (e: any) {
      if (isMountedRef.current) {
        setCurrentTextForTTS('OCR failed. Please try again.');
        setDocErrorMessage(`OCR failed: ${e.message}`);
        toast({ variant: 'destructive', title: 'OCR Failed', description: e.message });
      }
    } finally {
      if (isMountedRef.current) setIsPerformingOcr(false);
    }
  }, [activeDoc, pdfPageImage, pdfPageIsTextBased, currentPdfPageNum, stopSpeech, toast, epubPageIsImage]);

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
    if (!isMountedRef.current || ttsSettings.engine !== 'local') return;

    const currentSettings = ttsSettings;
    if (availableVoices.length === 0) return;

    const currentVoice = availableVoices.find(v => v.voiceURI === currentSettings.voiceURI);
    const currentVoiceIsValidForLanguage = currentVoice && currentVoice.lang && (currentVoice.lang === currentSettings.language || currentVoice.lang.startsWith(currentSettings.language.split('-')[0]));
            
    if (currentVoice && currentVoiceIsValidForLanguage) {
        return; // Current voice is valid for the selected language, no changes needed.
    }
    
    // Voice is invalid or not set, find a new default
    const defaultForLang = 
        availableVoices.find(v => v.lang === currentSettings.language && v.default) ||
        availableVoices.find(v => v.lang === currentSettings.language) ||
        availableVoices.find(v => v.lang?.startsWith(currentSettings.language.split('-')[0]) && v.default) ||
        availableVoices.find(v => v.lang?.startsWith(currentSettings.language.split('-')[0]));

    if (defaultForLang) {
        if (defaultForLang.voiceURI !== currentSettings.voiceURI || defaultForLang.lang !== currentSettings.language) {
            setTtsSettings(prev => ({ ...prev, voiceURI: defaultForLang.voiceURI, language: defaultForLang.lang }));
        }
    } else {
        const absoluteFallback = availableVoices.find(v => v.default && v.lang) || availableVoices[0];
        if (absoluteFallback && (absoluteFallback.voiceURI !== currentSettings.voiceURI || absoluteFallback.lang !== currentSettings.language)) {
            setTtsSettings(prev => ({...prev, voiceURI: absoluteFallback.voiceURI, language: absoluteFallback.lang }));
        }
    }
  }, [ttsSettings.language, ttsSettings.engine, availableVoices]);

  // Persist settings whenever they change
  useEffect(() => {
      LocalStorageService.saveTTSSettings(ttsSettings);
  }, [ttsSettings]);


  useEffect(() => {
    const player = new Audio(); audioPlayerRef.current = player;
    const handleAudioEnded = () => { 
        if (audioPlayerRef.current === player && isSpeaking && ttsSettings.engine === 'cloud' && isMountedRef.current) { 
            stopSpeech(true); 
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
  }, [ttsSettings.engine, isSpeaking, stopSpeech, toast]);

  // Effect for auto-scrolling the main content view
  useEffect(() => {
    if (isSpeaking && !isPaused && highlightedSegmentIndex > -1) {
      const scrollContainer = scrollContainerRef.current;
      const contentContainer = mainHighlightedContentRef.current;

      if (scrollContainer && contentContainer) {
          const element = contentContainer.querySelector('span');
          if (element) {
              const elementRect = element.getBoundingClientRect();
              const containerRect = scrollContainer.getBoundingClientRect();
              if (elementRect.top < containerRect.top || elementRect.bottom > containerRect.bottom) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
          }
      }
    }
  }, [highlightedSegmentIndex, isSpeaking, isPaused]);

  // Effect for auto-scrolling the TTS box view
  useEffect(() => {
    if (isSpeaking && !isPaused && highlightedSegmentIndex > -1) {
      const ttsBoxContainer = ttsBoxHighlightedContentRef.current;

      if (ttsBoxContainer) {
          const element = ttsBoxContainer.querySelector('span');
          if (element) {
              const elementRect = element.getBoundingClientRect();
              const containerRect = ttsBoxContainer.getBoundingClientRect();
              if (elementRect.top < containerRect.top || elementRect.bottom > containerRect.bottom) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
          }
      }
    }
  }, [highlightedSegmentIndex, isSpeaking, isPaused]);


  // The executor function for continuous reading.
  const _startSpeech = useCallback(async (origin: SpeechOrigin, startIndex = 0) => {
    if (!isMountedRef.current) return;
    
    const trimmedText = currentTextForTTS?.trim();
    if (!trimmedText) {
        toast({variant: "destructive", title: "No Text", description: "No text is available to be read aloud."});
        stopSpeech(true);
        return;
    }
    const invalidMessages = ["loading...", "performing ocr..."];
    if(invalidMessages.some(msg => trimmedText.toLowerCase().includes(msg))) {
        toast({variant: "destructive", title: "Cannot Play", description: "Please wait for the current action to complete."});
        stopSpeech(true);
        return;
    }

    stopSpeech(false);
    
    setTimeout(async () => {
        if (!isMountedRef.current) return;

        setIsSpeaking(true);
        isSpeakingRef.current = true;
        setIsPaused(false);
        setSpeechOrigin(origin);
        setIsLoadingTTS(true);

        if (ttsSettings.engine === 'local') {
            if (typeof window === 'undefined' || !window.speechSynthesis) {
                toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
                stopSpeech(true);
                return;
            }
            
            let charCount = 0;
            let startSegment = 0;

            for (let i = 0; i < textSegments.length; i++) {
                if (startIndex < (charCount + textSegments[i].length)) {
                    startSegment = i;
                    break;
                }
                charCount += textSegments[i].length;
            }
            segmentIndexRef.current = startSegment;

            const speakNext = () => {
                if (!isSpeakingRef.current || segmentIndexRef.current >= textSegments.length) {
                    if (isMountedRef.current) stopSpeech(true);
                    return;
                }

                const currentIndex = segmentIndexRef.current;
                let segmentText = textSegments[currentIndex];

                const textToSpeak = segmentText.replace(PUNCTUATION_REGEX, ' ').trim();

                if (!textToSpeak) {
                    segmentIndexRef.current++;
                    speakNext();
                    return;
                }

                const utterance = new SpeechSynthesisUtterance(textToSpeak);
                utterance.lang = ttsSettings.language;
                utterance.pitch = ttsSettings.pitch;
                utterance.rate = ttsSettings.rate;
                const systemVoices = window.speechSynthesis.getVoices();
                let voiceToUse = systemVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
                if (voiceToUse) utterance.voice = voiceToUse;

                utterance.onstart = () => {
                    if (isSpeakingRef.current && isMountedRef.current) {
                        setHighlightedSegmentIndex(currentIndex);
                    }
                };

                utterance.onend = () => {
                    segmentIndexRef.current++;
                    setTimeout(speakNext, 50); // Small delay between utterances
                };

                utterance.onerror = (event) => {
                    if (isMountedRef.current && event.error !== 'canceled' && event.error !== 'interrupted') {
                        console.error("SpeechSynthesis Error:", event.error);
                        toast({ variant: "destructive", title: "TTS Error", description: event.error || "An unknown error occurred." });
                        stopSpeech(true);
                    }
                };
                
                utteranceRef.current = utterance;
                window.speechSynthesis.speak(utterance);
            };

            if(isMountedRef.current) setIsLoadingTTS(false);
            speakNext();

        } else { // Cloud TTS
            try {
                // For cloud, we still send the whole text from the start index for simplicity.
                const textForCloud = currentTextForTTS.substring(startIndex);
                const cleanedTextForCloud = textForCloud.replace(PUNCTUATION_REGEX, ' ').trim();

                if (!cleanedTextForCloud) {
                    toast({ variant: "destructive", title: "No Text to Speak", description: "Text contains only punctuation." });
                    stopSpeech(true);
                    return;
                }

                if (audioPlayerRef.current) audioPlayerRef.current.loop = false;
                const result = await getCloudSpeech(cleanedTextForCloud, ttsSettings.language);
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
    }, 50);
  }, [ttsSettings, stopSpeech, toast, textSegments, currentTextForTTS]);

  const speakTextOnce = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
        toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
        return;
    }
    
    stopSpeech(true); 

    if (ttsSettings.engine === 'cloud') {
      toast({ title: "Info", description: "Repeating selection with Cloud TTS is not yet implemented." });
      return;
    }

    const cleanedText = text.replace(PUNCTUATION_REGEX, ' ').trim();
    if (!cleanedText) {
        toast({ title: 'No Text to Speak', description: 'Your selection contains only punctuation.' });
        return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanedText);
    utterance.lang = ttsSettings.language;
    utterance.pitch = ttsSettings.pitch;
    utterance.rate = ttsSettings.rate;
    const voiceToUse = availableVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
    if (voiceToUse) {
        const systemVoice = window.speechSynthesis.getVoices().find(v => v.voiceURI === voiceToUse.voiceURI);
        if (systemVoice) utterance.voice = systemVoice;
    }
    
    utterance.onerror = (event) => {
        if (isMountedRef.current && event.error !== 'canceled' && event.error !== 'interrupted') {
            toast({ variant: "destructive", title: "TTS Error", description: event.error || "Speech failed." });
        }
    };
    
    setTimeout(() => {
        if(isMountedRef.current) window.speechSynthesis.speak(utterance);
    }, 50);

  }, [ttsSettings, availableVoices, stopSpeech, toast]);

  // The "brain" function for the main play button.
  const playPauseSpeech = () => {
    if (!isMountedRef.current) return;
    
    if (isSpeaking) {
      // It's already playing, so toggle pause/resume
      if (isPaused) {
        if (ttsSettings.engine === 'local' && window.speechSynthesis) { window.speechSynthesis.resume(); } 
        else { audioPlayerRef.current?.play().catch(() => stopSpeech(true)); }
        setIsPaused(false);
      } else {
        if (ttsSettings.engine === 'local' && window.speechSynthesis) { window.speechSynthesis.pause(); } 
        else { audioPlayerRef.current?.pause(); }
        setIsPaused(true);
      }
    } else {
      // Not speaking, so start a new playback
      const selectionInfo = selectionInfoRef.current;
      // Use selection start index if available, otherwise start from beginning.
      const startIndex = selectionInfo?.startIndex ?? 0;
      _startSpeech('main', startIndex);
    }
  };
  
  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    if(!isMountedRef.current) return;
    stopSpeech(true);

    if (key === 'voiceURI') {
        const selectedVoice = availableVoices.find(v => v.voiceURI === value);
        if (selectedVoice) {
            setTtsSettings(prev => ({ ...prev, voiceURI: selectedVoice.voiceURI, language: selectedVoice.lang }));
        }
    } else {
        setTtsSettings(prevSettings => {
            const newSettings = { ...prevSettings, [key]: value };
            if (key === 'engine') newSettings.type = value as 'local' | 'cloud';
            if (key === 'type') newSettings.engine = value as 'local' | 'cloud';
            return newSettings;
        });
    }
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
    if (isRenderingPdfPage || isLoadingDoc) return;
    
    setCurrentPdfPageNum(prevPageNum => {
        if (!pdfDocProxy) return prevPageNum;

        let newPage = prevPageNum;
        if (direction === 'prev' && prevPageNum > 1) {
            newPage = prevPageNum - 1;
        } else if (direction === 'next' && prevPageNum < pdfTotalPages) {
            newPage = prevPageNum + 1;
        }

        if (newPage !== prevPageNum) {
            stopSpeech(true);
        }
        return newPage;
    });
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
    const isContentLoading = isLoadingDoc || isEpubLoading || (activeDoc?.type === 'pdf' && !isPdfTextView && isRenderingPdfPage);

    if (isContentLoading) {
      return { text: "Loading...", icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, disabled: true, variant: "outline" as const };
    }
    if (isLoadingTTS && speechOrigin === 'main') {
      return { text: "Loading...", icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, disabled: true, variant: "outline" as const };
    }
    // If a selection exists, the button text can be more specific
    if (selectionInfoRef.current && selectionInfoRef.current.text.trim().length > 0 && !isSpeaking) {
        return { text: "Play from Selection", icon: <Play className="mr-1 h-4 w-4" />, disabled: false, variant: "default" as const }
    }
    // Otherwise, it's a toggle for the whole document
    if (isSpeaking && speechOrigin === 'main') {
      return isPaused 
        ? { text: "Resume", icon: <Play className="mr-1 h-4 w-4" />, disabled: false, variant: "default" as const } 
        : { text: "Pause", icon: <Pause className="mr-1 h-4 w-4" />, disabled: false, variant: "outline" as const };
    }
    return { text: "Play Text", icon: <Play className="mr-1 h-4 w-4" />, disabled: false, variant: "default" as const };
  };

  const openJumpDialog = (type: 'pdf' | 'epub', currentPage: number, totalPages: number) => {
    if (totalPages <= 0) return;
    setJumpDialogInfo({ open: true, type, currentPage, totalPages });
    setJumpToPageInput(String(currentPage));
  };
  
  const handleCancelJump = () => {
    setJumpToPageInput("");
    setJumpDialogInfo({ open: false, type: null, currentPage: 0, totalPages: 0 });
  };

  const handleConfirmJump = () => {
    const pageNum = parseInt(jumpToPageInput, 10);
    const { type, totalPages } = jumpDialogInfo;

    if (!type || isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
        toast({
            variant: "destructive",
            title: "Invalid Page Number",
            description: `Please enter a number between 1 and ${totalPages}.`,
        });
        return;
    }

    if (type === 'pdf') {
        if (pageNum !== currentPdfPageNum) {
            stopSpeech(true);
            setCurrentPdfPageNum(pageNum);
        }
    } else if (type === 'epub') {
        if (epubRenditionRef.current?.locations && (pageNum - 1) !== epubCurrentPageNum) {
            const cfi = epubRenditionRef.current.locations.cfiFromPage(pageNum - 1);
            if (cfi) {
                stopSpeech(true);
                epubRenditionRef.current.display(cfi);
            }
        }
    }
    handleCancelJump();
  };

  const mainButtonState = getMainButtonState();
  
  const showInitialLoader = isLoadingDoc && !activeDoc && !docErrorMessage;
  const showDocumentError = docErrorMessage && !activeDoc;
  
  if (showInitialLoader) { 
    return <div className="flex items-center justify-center h-full flex-grow"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="ml-4 text-lg">Loading document...</p></div>; 
  }
  if (showDocumentError) { 
    return <div className="flex flex-col items-center justify-center h-full flex-grow p-4 text-center"> <AlertTriangle className="h-12 w-12 text-destructive mb-4" /> <h2 className="text-xl font-semibold mb-2">Error Loading Document</h2> <p className="text-muted-foreground mb-4">{docErrorMessage}</p> <Button onClick={() => router.push('/library')}>Go to Library</Button> </div>; 
  }
  
  const showOcrButtonForPdfPage = activeDoc?.type === 'pdf' && !isPdfTextView && pdfPageImage && !isRenderingPdfPage && !isLoadingDoc && !pdfPageIsTextBased;
  const showOcrButtonForImage = activeDoc?.type === 'image' && displayedImageSrc && !isLoadingDoc && !isPerformingOcr;
  const showOcrButtonForEpubPage = activeDoc?.type === 'epub' && epubPageIsImage && !isLoadingDoc && !isPerformingOcr;


  return (
    <div className="flex flex-col lg:flex-row w-full h-[calc(100vh-4rem)]">
      {/* Reader Content Pane */}
      <div className="flex-grow flex flex-col bg-muted/20 p-2 md:p-4 min-w-0">
        
        {/* Top part: Scrollable Content Area */}
        <div ref={scrollContainerRef} onScroll={(e) => scrollPositionRef.current = e.currentTarget.scrollTop} className="flex-grow overflow-y-auto rounded-lg bg-background shadow-inner relative flex flex-col justify-start">
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
                <div className="w-full flex-grow">
                  {(isSpeaking || isPaused) ? (
                    <div ref={mainHighlightedContentRef} className="w-full h-full whitespace-pre-wrap select-text text-sm overflow-y-auto">
                      {speakingViewContent}
                    </div>
                  ) : (
                    <Textarea
                        ref={mainTextAreaRef}
                        id="scratchpad-input"
                        placeholder="Welcome to the Scratchpad!

Type or paste any text here to have it read aloud or to save snippets to your favorites."
                        className="w-full h-full text-sm resize-none border-none focus-visible:ring-0 p-0 shadow-none bg-transparent"
                        value={scratchpadText}
                        onChange={(e) => {
                            setScratchpadText(e.target.value);
                            setCurrentTextForTTS(e.target.value);
                        }}
                        aria-label="Scratchpad for custom text input"
                    />
                  )}
                </div>
              </div>
            )}

            {/* PDF Text View */}
            {activeDoc?.type === 'pdf' && isPdfTextView && (
              <div className="w-full h-full p-2 md:p-4 flex flex-col">
                  <div ref={mainHighlightedContentRef} className="w-full flex-grow whitespace-pre-wrap select-text px-3 py-2 text-sm min-h-[80px]">
                      {(isSpeaking || isPaused) ? speakingViewContent : <>{pdfTextContent || ''}</>}
                  </div>
              </div>
            )}


            {/* PDF Image Content */}
            {activeDoc?.type === 'pdf' && !isPdfTextView && (
                <div className="w-full text-center p-4 space-y-4">
                    {pdfPageImage && <NextImage src={pdfPageImage} alt={`Page ${currentPdfPageNum}`} width={0} height={0} style={{ width: 'auto', height: 'auto', maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', transform: `scale(${pdfScale})`, transformOrigin: 'top center' }} className="shadow-lg border rounded-md" />}
                </div>
            )}
            
            {/* EPUB Content */}
            <div id="epub-container" className={cn("w-full h-full flex flex-col items-center", activeDoc?.type !== 'epub' && "hidden")}>
                <div
                    key={activeDoc?.id || 'epub-placeholder'}
                    id="epub-viewer"
                    ref={epubViewerRef}
                    className="w-full flex-grow"
                />
            </div>

            {/* TXT Content */}
            {activeDoc?.type === 'txt' && (
              <div className="w-full h-full p-2 md:p-4 flex flex-col">
                  <div ref={mainHighlightedContentRef} className="w-full flex-grow whitespace-pre-wrap select-text px-3 py-2 text-sm min-h-[80px]">
                      {(isSpeaking || isPaused) ? speakingViewContent : <>{txtContent}</>}
                  </div>
              </div>
            )}


            {/* Image Content */}
            {activeDoc?.type === 'image' && displayedImageSrc && (
                <div className="w-full text-center p-4 space-y-4">
                    <NextImage src={displayedImageSrc} alt={activeDoc.title || 'Uploaded Image'} width={800} height={600} style={{objectFit: 'contain'}} className="max-w-full max-h-[calc(100%-4rem)] shadow-lg border rounded-md inline-block" data-ai-hint="illustration abstract" />
                </div>
            )}

            {/* Mobi Not Supported Message */}
            {activeDoc?.type === 'mobi' && ( <div className="p-4 bg-background rounded-md shadow-inner text-center h-full flex flex-col justify-center items-center"> <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2"/> <p className="font-semibold">MOBI Not Supported</p> <p className="text-sm text-muted-foreground">Please convert to EPUB or PDF.</p> </div> )}
        </div>

        {/* Floating OCR Button */}
        <div className="flex-shrink-0 py-2 flex justify-center">
            {(showOcrButtonForPdfPage || showOcrButtonForImage || showOcrButtonForEpubPage) && (
              <Button onClick={handlePerformOcr} disabled={isPerformingOcr}>
                {isPerformingOcr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanText className="mr-2 h-4 w-4" />}
                {activeDoc?.type === 'image' && 'Perform OCR on Image'}
                {activeDoc?.type === 'pdf' && 'Perform OCR on PDF Page'}
                {activeDoc?.type === 'epub' && 'Perform OCR on Page'}
              </Button>
            )}
        </div>

        {/* Bottom part: TTS Box - Fixed at the bottom of the content pane */}
        {activeDoc && !isLoadingDoc && (
            <div className="flex-shrink-0 pt-2">
                <Card className="shadow-md">
                    <CardHeader className="pb-1 pt-3">
                        <CardTitle className="text-sm flex items-center"><FileText className="mr-2 h-4 w-4"/> Current Text for TTS</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {(isSpeaking || isPaused) ? (
                            <div ref={ttsBoxHighlightedContentRef} className="w-full h-20 px-3 py-2 border rounded-md bg-muted/30 overflow-y-auto whitespace-pre-wrap select-text text-sm">
                                {speakingViewContent}
                            </div>
                        ) : (
                            <textarea ref={ttsBoxTextAreaRef} readOnly value={currentTextForTTS} className="w-full h-20 px-3 py-2 border rounded-md bg-muted/30 text-sm overflow-y-auto whitespace-pre-wrap select-text" placeholder="Text for TTS..." />
                        )}
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
                        ? `Type: ${activeDoc.type?.toUpperCase()}${activeDoc?.type === 'pdf' && !isPdfTextView && pdfTotalPages > 0 ? `, Page: ${currentPdfPageNum}/${pdfTotalPages}` : ''}`
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

            {(activeDoc?.type === 'pdf' && !isPdfTextView && pdfTotalPages > 0) && (
              <Card>
                <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">PDF Navigation & View</CardTitle></CardHeader>
                <CardContent className="space-y-2 pt-0">
                  <div className="flex items-center justify-between">
                    <Button onClick={() => navigatePdf('prev')} disabled={isLoadingDoc || isRenderingPdfPage || currentPdfPageNum <= 1} size="sm" variant="outline"><ChevronLeft /> Prev</Button>
                    <Button variant="ghost" className="h-9 tabular-nums" onClick={() => openJumpDialog('pdf', currentPdfPageNum, pdfTotalPages)}>
                        {currentPdfPageNum} / {pdfTotalPages}
                    </Button>
                    <Button onClick={() => navigatePdf('next')} disabled={isLoadingDoc || isRenderingPdfPage || currentPdfPageNum >= pdfTotalPages} size="sm" variant="outline">Next <ChevronRight /></Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={() => handlePdfScaleChange(pdfScale - 0.25)} size="icon" variant="outline" className="h-7 w-7" disabled={isRenderingPdfPage || pdfScale <= 0.25}><ZoomOut className="h-4 w-4"/></Button>
                    <Slider value={[pdfScale]} min={0.25} max={5} step={0.25} onValueChange={([val]) => handlePdfScaleChange(val)} disabled={isRenderingPdfPage} />
                    <Button onClick={() => handlePdfScaleChange(pdfScale + 0.25)} size="icon" variant="outline" className="h-7 w-7" disabled={isRenderingPdfPage || pdfScale >= 5}><ZoomIn className="h-4 w-4"/></Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeDoc?.type === 'epub' && (
              <Card>
                <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">EPUB Navigation</CardTitle></CardHeader>
                <CardContent className="flex items-center justify-between pt-0">
                    <Button onClick={() => navigateEpub('prev')} size="sm" variant="outline" disabled={isEpubLoading || isLoadingDoc}> <ChevronLeft /> Previous </Button>
                    
                    {isEpubPaginating ? (
                      <span className="text-sm text-muted-foreground px-2">Page info loading...</span>
                    ) : epubTotalPages > 0 ? (
                      <Button variant="ghost" className="h-9 tabular-nums" onClick={() => openJumpDialog('epub', epubCurrentPageNum + 1, epubTotalPages)}>
                          {epubCurrentPageNum + 1} / {epubTotalPages}
                      </Button>
                    ) : (
                      <span className="text-sm text-muted-foreground px-2">No page info</span>
                    )}
                    
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
                
                <Button onMouseDown={(e) => {
                    e.preventDefault();
                    selectionInfoRef.current = getSelectedText();
                  }} 
                  onClick={playPauseSpeech} 
                  disabled={mainButtonState.disabled} 
                  variant={mainButtonState.variant} 
                  className="w-full h-9 text-sm"
                >
                  {mainButtonState.icon} {mainButtonState.text}
                </Button>
                
                <div className="grid grid-cols-2 gap-2 mt-2">
                    <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="w-full text-xs"> <Star className="mr-2 h-3 w-3" /> Favorite Text </Button>
                    <Button 
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const selection = getSelectedText();
                        if (selection.text.trim()) {
                          speakTextOnce(selection.text);
                        } else {
                          toast({ title: "No Selection", description: "Please select text to repeat." });
                        }
                      }}
                      variant="outline" 
                      size="sm" 
                      className="w-full text-xs" 
                      disabled={isLoadingTTS}
                    > 
                      <Repeat className="mr-2 h-3 w-3" /> Repeat Selection
                    </Button>
                </div>
              </CardContent>
            </Card>
        </div>
      </aside>

      <AlertDialog open={jumpDialogInfo.open} onOpenChange={(isOpen) => !isOpen && handleCancelJump()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Jump to Page</AlertDialogTitle>
            <AlertDialogDescription>
              Enter a page number between 1 and {jumpDialogInfo.totalPages}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input
              type="number"
              value={jumpToPageInput}
              onChange={(e) => setJumpToPageInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirmJump()}
              placeholder={`Page (1-${jumpDialogInfo.totalPages})`}
              className="text-center"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelJump}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmJump}>Jump</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
