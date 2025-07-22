
"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import NextImage from 'next/image';
import { GlobalWorkerOptions, getDocument, version } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import ePub from 'epubjs';
import type Book from 'epubjs/types/book';
import type Rendition from 'epubjs/types/rendition';
import type { Locations } from 'epubjs/types/locations';
import dynamic from 'next/dynamic';


import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Loader2, Play, Pause, Smartphone, Cloud as CloudIcon, Star, AlertTriangle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, BookOpen, Settings2, FileText, ScanText, Trash2, Edit, Repeat, X, CaseSensitive, MessageSquarePlus, ImagePlus, FileImage, Pencil, Expand, Shrink } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";


import { getCloudSpeech, performOCR } from '@/app/actions';
import * as LocalStorageService from '@/lib/localStorageService';
import * as IndexedDBService from '@/lib/indexedDBService';
import type { TTSSettings, TTSVoice, StoredMangaDocument, ActiveMangaDocument, StoredPdfDocument, StoredImageDocument, StoredEpubDocument, StoredTxtDocument, StoredMobiDocument, FavoriteItem, Annotation, NoteFavoriteItem } from '@/types';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { edgeTTSLanguageVoices } from '@/lib/edge-tts-voices';

const PDF_DEFAULT_SCALE = 1.0;
const PUNCTUATION_REGEX = /[.,?!,。？！，、\n\r"“„”'‘’`*_{}\[\]()#&@:;~<>/\\|\-—–^%$]/g;

type SpeechOrigin = 'main' | 'repeat' | null;


const groupVoicesByLanguage = (voices: TTSVoice[]) => {
  return voices.reduce((acc, voice) => {
    const lang = voice.lang || 'Unknown';
    if (!acc[lang]) {
      acc[lang] = [];
    }
    acc[lang].push(voice);
    return acc;
  }, {} as Record<string, TTSVoice[]>);
};

// Define a type for the locked selection to ensure type safety
type SelectionForAnnotation = {
  text: string;
  startIndex: number;
  pageNumber: number; // Optional because not all contexts (like scratchpad) have a page number
} | null;



function ReaderPageContent() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const docId = searchParams.get('docId');

  const [activeDoc, setActiveDoc] = useState<ActiveMangaDocument | null>(null);
  const [isLoadingDoc, setIsLoadingDoc] = useState(true);
  const [docErrorMessage, setDocErrorMessage] = useState<string | null>(null);

  const [pdfDocProxy, setPdfDocProxy] = useState<PDFDocumentProxy | null>(null);
  const [currentPdfPageNum, setCurrentPdfPageNum] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfPageImage, setPdfPageImage] = useState<string | null>(null);
  const [isRenderingPdfPage, setIsRenderingPdfPage] = useState(false);
  const [pdfPageIsTextBased, setPdfPageIsTextBased] = useState(true);
  const [isPdfTextView, setIsPdfTextView] = useState(false);
  const [pdfTextContent, setPdfTextContent] = useState<string | null>(null);
  const [viewScale, setViewScale] = useState(1);


  const epubViewerRef = useRef<HTMLDivElement | null>(null);
  const epubBookRef = useRef<Book | null>(null);
  const epubRenditionRef = useRef<Rendition | null>(null);
  const [isEpubLoading, setIsEpubLoading] = useState(false);
  const [epubPageIsImage, setEpubPageIsImage] = useState(false);
  const epubImageForOcrRef = useRef<string | null>(null);
  const [epubTotalPages, setEpubTotalPages] = useState(0);
  const [epubCurrentPageNum, setEpubCurrentPageNum] = useState(1);
  const [isEpubPaginating, setIsEpubPaginating] = useState(true);
  const [isEpubReadyForJumping, setIsEpubReadyForJumping] = useState(false);


  const [txtContent, setTxtContent] = useState<string>("");
  const [displayedImageSrc, setDisplayedImageSrc] = useState<string | null>(null);
  const currentImageObjectUrlRef = useRef<string | null>(null);
  
  const [scratchpadText, setScratchpadText] = useState<string>(LocalStorageService.loadScratchpadText());
  const [scratchpadAnnotations, setScratchpadAnnotations] = useState<Annotation[]>(LocalStorageService.loadScratchpadAnnotations());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const [isPerformingOcr, setIsPerformingOcr] = useState(false);
  const [currentTextForTTS, setCurrentTextForTTS] = useState<string>("");
  const [ttsSettings, setTtsSettings] = useState<TTSSettings>(LocalStorageService.defaultTTSSettings);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);
  const [isLoadingTTS, setIsLoadingTTS] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speechOrigin, setSpeechOrigin] = useState<SpeechOrigin>(null);
  const [highlightedSegmentIndex, setHighlightedSegmentIndex] = useState<number>(-1);
  const [ttsTextSize, setTtsTextSize] = useState<number>(LocalStorageService.loadTtsTextSize());
  const [isTtsAreaExpanded, setIsTtsAreaExpanded] = useState(false);


  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const mainHighlightedContentRef = useRef<HTMLDivElement | null>(null);
  const ttsBoxHighlightedContentRef = useRef<HTMLDivElement | null>(null);


  const isMountedRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const segmentIndexRef = useRef(0);
  
  // This state "locks in" the selection when the user decides to create an annotation.
  const [selectionForAnnotation, setSelectionForAnnotation] = useState<SelectionForAnnotation>(null);

  const mainTextAreaRef = useRef<HTMLTextAreaElement | null>(null); 
  const ttsBoxTextAreaRef = useRef<HTMLTextAreaElement | null>(null); 

  const [jumpDialogInfo, setJumpDialogInfo] = useState<{
    open: boolean;
    type: 'pdf' | 'epub' | null;
    currentPage: number;
    totalPages: number;
  }>({ open: false, type: null, currentPage: 0, totalPages: 0 });
  const [jumpToPageInput, setJumpToPageInput] = useState("");

  const [annotationDialog, setAnnotationDialog] = useState({
    open: false,
    id: null as string | null, // Add id for editing
    note: '',
    imageDataUrl: '',
    isSaving: false,
  });
  const annotationImageInputRef = useRef<HTMLInputElement | null>(null);
  const [viewingAnnotation, setViewingAnnotation] = useState<Annotation | null>(null);
  const [annotationToDelete, setAnnotationToDelete] = useState<Annotation | null>(null);


  const textSegments = useMemo(() => {
    if (!currentTextForTTS) return [];
    const parts = currentTextForTTS.split(/([.?!,。？！，、\n]+)/g);
    const segments = [];
    for (let i = 0; i < parts.length; i += 2) {
      const text = parts[i];
      const delimiter = parts[i + 1] || '';
      if (text || delimiter) {
        segments.push(text + delimiter);
      }
    }
    return segments.filter(s => s.length > 0);
  }, [currentTextForTTS]);
  
  
  const sortedAnnotations = useMemo(() => {
    let allAnnotations: Annotation[] = [];
    if (activeDoc) {
        // For documents, filter annotations by the current page number
        const pageNum = activeDoc.type === 'pdf' ? currentPdfPageNum : activeDoc.type === 'epub' ? epubCurrentPageNum : 1;
        allAnnotations = (activeDoc.annotations || []).filter(ann => ann.pageNumber === pageNum);
    } else {
        // For scratchpad, there are no page numbers
        allAnnotations = scratchpadAnnotations;
    }
    return allAnnotations.sort((a, b) => a.startIndex - b.startIndex);
}, [activeDoc, scratchpadAnnotations, currentPdfPageNum, epubCurrentPageNum]);


const getCharPosition = (container: HTMLElement, charIndex: number): { top: number, left: number } | null => {
  const range = document.createRange();
  let walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  let currentNode: Node | null = null;
  let currentOffset = 0;

  while ((currentNode = walker.nextNode())) {
      const nodeLength = currentNode.textContent?.length || 0;
      if (currentOffset + nodeLength >= charIndex) {
          range.setStart(currentNode, charIndex - currentOffset);
          range.setEnd(currentNode, charIndex - currentOffset);
          const rect = range.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          return {
              top: rect.top - containerRect.top + container.scrollTop,
              left: rect.left - containerRect.left + container.scrollLeft
          };
      }
      currentOffset += nodeLength;
  }
  return null;
};

const AnnotationMarkers = ({ containerRef, annotations, text }: { containerRef: React.RefObject<HTMLElement>, annotations: Annotation[], text: string }) => {
    const [positions, setPositions] = useState<Record<string, { top: number, left: number }>>({});

    useEffect(() => {
        if (containerRef.current && annotations.length > 0) {
            const newPositions: Record<string, { top: number, left: number }> = {};
            annotations.forEach(ann => {
                const pos = getCharPosition(containerRef.current!, ann.startIndex + ann.targetText.length -1);
                if (pos) {
                    newPositions[ann.id] = pos;
                }
            });
            setPositions(newPositions);
        }
    }, [annotations, containerRef, text]); // Re-calculate when text or annotations change

    if (annotations.length === 0) return null;

    return (
        <>
            {annotations.map((annotation, index) => {
                const pos = positions[annotation.id];
                if (!pos) return null;

                return (
                    <sup
                        key={annotation.id}
                        className="absolute w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs leading-none cursor-pointer"
                        style={{ top: pos.top, left: pos.left, transform: 'translate(0, -50%)' }}
                        onClick={(e) => { e.stopPropagation(); setViewingAnnotation(annotation); }}
                    >
                        {index + 1}
                    </sup>
                );
            })}
        </>
    );
};


const renderedTextWithAnnotations = useMemo(() => {
  const text = currentTextForTTS;
  if (!text) return null;
  
  // This key forces a re-render when the page number changes, fixing the EPUB annotation bug.
  const pageKey = activeDoc ? `${activeDoc.id}-${activeDoc.type === 'pdf' ? currentPdfPageNum : epubCurrentPageNum}` : 'scratchpad';

  const renderContent = (ref: React.RefObject<HTMLDivElement>, isInteractive: boolean) => (
    <div key={pageKey} ref={ref} className="relative w-full h-full">
      <div className={cn("w-full h-full whitespace-pre-wrap", isInteractive && "select-text")}>
        {text}
      </div>
      {isInteractive && <AnnotationMarkers containerRef={ref} annotations={sortedAnnotations} text={text} />}
    </div>
  );
  
  return renderContent(mainHighlightedContentRef, true);

}, [currentTextForTTS, sortedAnnotations, activeDoc, currentPdfPageNum, epubCurrentPageNum]);

const renderedTextWithoutAnnotations = useMemo(() => {
    const text = currentTextForTTS;
    if (!text) return null;
    return (
        <div ref={mainHighlightedContentRef} className="relative w-full h-full">
            <div className="w-full h-full whitespace-pre-wrap select-text">
                {text}
            </div>
        </div>
    );
}, [currentTextForTTS]);


  const speakingViewContent = useMemo(() => {
    if (!isSpeaking && !isPaused) return renderedTextWithAnnotations;
    if (highlightedSegmentIndex < 0 || !textSegments[highlightedSegmentIndex]) {
      return renderedTextWithAnnotations;
    }

    const preText = textSegments.slice(0, highlightedSegmentIndex).join('');
    const highlightedText = textSegments[highlightedSegmentIndex];
    const postText = textSegments.slice(highlightedSegmentIndex + 1).join('');

    return (
      <div className="whitespace-pre-wrap">
        {preText}
        <span className="text-green-600 dark:text-green-500">{highlightedText}</span>
        {postText}
      </div>
    );
  }, [isSpeaking, isPaused, highlightedSegmentIndex, textSegments, renderedTextWithAnnotations]);


  const getSelectedText = useCallback((): { text: string; startIndex: number | null } => {
    if (typeof window === 'undefined') {
        return { text: '', startIndex: null };
    }

    let activeElement: HTMLTextAreaElement | HTMLDivElement | null = null;
    if (document.activeElement === mainTextAreaRef.current) {
        activeElement = mainTextAreaRef.current;
    } else if (document.activeElement === ttsBoxTextAreaRef.current) {
        activeElement = ttsBoxTextAreaRef.current;
    }

    if (activeElement && 'selectionStart' in activeElement && activeElement.selectionStart !== activeElement.selectionEnd) {
        return {
            text: activeElement.value.substring(activeElement.selectionStart, activeElement.selectionEnd),
            startIndex: activeElement.selectionStart,
        };
    }
  
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return { text: '', startIndex: null };

    const getSelectionDetails = (container: HTMLElement): { text: string; startIndex: number } | null => {
        if (!selection.rangeCount || !container.contains(selection.anchorNode)) {
            return null;
        }

        const range = selection.getRangeAt(0);
        const preSelectionRange = range.cloneRange();
        preSelectionRange.selectNodeContents(container);
        preSelectionRange.setEnd(range.startContainer, range.startOffset);
        
        const startIndex = preSelectionRange.toString().length;
        const text = range.toString();

        return { text, startIndex };
    };

    const mainContainer = mainHighlightedContentRef.current;
    if(mainContainer) {
      const details = getSelectionDetails(mainContainer);
      if (details) return details;
    }

    const ttsContainer = ttsBoxHighlightedContentRef.current;
     if(ttsContainer && ttsContainer.contains(selection.anchorNode)) {
      const details = getSelectionDetails(ttsContainer);
      if (details) return details;
    }
    
    // Fallback for EPUB iframe
    if (activeDoc?.type === 'epub' && epubRenditionRef.current) {
        try {
            const epubWindow = epubRenditionRef.current.getContents()?.[0]?.window;
            if (epubWindow && epubWindow.getSelection()?.toString()) {
                const epubSelection = epubWindow.getSelection();
                if(epubSelection) {
                  return { text: epubSelection.toString(), startIndex: null }; // startIndex is hard for iframes
                }
            }
        } catch (e) { console.warn("Could not get selection from EPUB iframe", e); }
    }
  
    return { text: selection.toString(), startIndex: null };
}, [activeDoc?.type]);


  useEffect(() => {
    isMountedRef.current = true;
    if (typeof window !== 'undefined') {
      GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.mjs`;
    }
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!activeDoc && !isLoadingDoc) {
      LocalStorageService.saveScratchpadText(scratchpadText);
      LocalStorageService.saveScratchpadAnnotations(scratchpadAnnotations);
    }
  }, [scratchpadText, scratchpadAnnotations, activeDoc, isLoadingDoc]);


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

        if (imageElement) {
            imageElement.crossOrigin = "anonymous";
            if (imageElement.complete && imageElement.naturalWidth > 0) {
                updateOcrSourceFromImage(imageElement);
            } else {
                setCurrentTextForTTS("Loading image for OCR...");
                setEpubPageIsImage(true); 
                imageElement.onload = () => updateOcrSourceFromImage(imageElement);
                imageElement.onerror = () => {
                    if (!isMountedRef.current) return;
                    epubImageForOcrRef.current = null;
                    const pageText = (contentBody.innerText || "").trim();
                    setCurrentTextForTTS(pageText || "Could not load image. No fallback text found.");
                    setEpubPageIsImage(false);
                };
            }
        } else { 
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
            setEpubPageIsImage(false); 
        }
    }
  }, [updateOcrSourceFromImage]);

  useEffect(() => {
    let isStale = false;
    
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
            const savedAnnotations = LocalStorageService.loadScratchpadAnnotations();
            setScratchpadText(savedText);
            setScratchpadAnnotations(savedAnnotations);
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
              setIsEpubPaginating(true);
              setIsEpubReadyForJumping(false);

              try {
                  const book = ePub(doc.fileData);
                  epubBookRef.current = book;
            
                  if (isStale) return;
                  if (!epubViewerRef.current) throw new Error("EPUB viewer element not ready.");
            
                  const rendition = book.renderTo(epubViewerRef.current, { width: "100%", height: "100%", flow: "paginated", spread: "none" });
                  epubRenditionRef.current = rendition;

                  const generateEpubPagination = async (b: Book) => {
                      if (!isMountedRef.current || isStale) return;
                      try {
                          await b.ready;
                          if (isStale || !isMountedRef.current) return;
                          await b.locations.generate(1650);
                          if (isStale || !isMountedRef.current) return;
                          
                          setEpubTotalPages(b.locations.length());
                          setIsEpubReadyForJumping(true); 
                      } catch (e: any) {
                          if (isStale) return;
                          console.error("EPUB pagination failed:", e.message);
                          setEpubTotalPages(0);
                          setIsEpubReadyForJumping(false); 
                      } finally {
                          if (isMountedRef.current) setIsEpubPaginating(false);
                      }
                  };

                  rendition.on('relocated', (location: any) => {
                      if (!isMountedRef.current || !epubBookRef.current?.locations || !epubBookRef.current.navigation) return;
                      
                      const currentDocId = (activeDoc as ActiveMangaDocument | null)?.id;
                      if (currentDocId) {
                          LocalStorageService.saveCurrentEpubCfiForDoc(currentDocId, location.start.cfi);
                      }

                      if (epubBookRef.current.locations.length() > 0) {
                          const percentage = epubBookRef.current.locations.percentageFromCfi(location.start.cfi);
                          const total = epubBookRef.current.locations.length();
                          const pageNum = Math.max(1, Math.round(percentage * total));
                          setEpubCurrentPageNum(pageNum);
                      }
                      
                      processEpubView(epubRenditionRef.current?.getContents()?.[0]);
                  });
                  
                  generateEpubPagination(book);

                  const lastLocation = LocalStorageService.loadCurrentEpubCfiForDoc(doc.id); 
                  await rendition.display(lastLocation || undefined);

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
    
    stopSpeech(true);
    setDocErrorMessage(null);
    setActiveDoc(null);
    setIsLoadingDoc(true);
    setTxtContent("");
    setDisplayedImageSrc(null);
    setIsEpubLoading(false);
    setCurrentTextForTTS("");
    setEpubTotalPages(0);
    setEpubCurrentPageNum(1);
    setIsEpubPaginating(true);
    setIsEpubReadyForJumping(false);
    
    
    loadDocument();
    
    return () => {
      isStale = true;
      stopSpeech(true);

      if (pdfDocProxy) {
        try { pdfDocProxy.destroy(); } catch (e) { console.warn("Non-critical error destroying PDF proxy", e); }
        setPdfDocProxy(null);
      }
      setPdfTextContent(null);
      setIsPdfTextView(false);
      
      if (currentImageObjectUrlRef.current) {
        URL.revokeObjectURL(currentImageObjectUrlRef.current);
        currentImageObjectUrlRef.current = null;
      }
      
      if (epubRenditionRef.current) {
        epubRenditionRef.current.destroy();
        epubRenditionRef.current = null;
      }
      if (epubBookRef.current) {
          epubBookRef.current.destroy();
          epubBookRef.current = null;
      }
      if (epubViewerRef.current) {
        epubViewerRef.current.innerHTML = '';
      }
      
      setEpubPageIsImage(false);
      epubImageForOcrRef.current = null;
    };
  }, [docId, router, processEpubView, stopSpeech]);


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
            
            const viewport = page.getViewport({ scale: viewScale });
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
  }, [pdfDocProxy, currentPdfPageNum, viewScale, activeDoc, isPdfTextView, stopSpeech]);


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
      if (isMountedRef.current) {
          const merged = {
              ...loadedSettings,
              engine: engine,
              type: engine
          };
          if (merged.engine === 'cloud' && (!merged.language || !merged.cloudVoiceId)) {
              const defaultLocale = 'en-US';
              merged.language = defaultLocale;
              if (edgeTTSLanguageVoices[defaultLocale].voices.length > 0) {
                merged.cloudVoiceId = edgeTTSLanguageVoices[defaultLocale].voices[0].id;
              }
          }
          setTtsSettings(prev => ({...prev, ...merged}));
      }
    }
  }, []);

  useEffect(() => {
    LocalStorageService.saveTtsTextSize(ttsTextSize);
  }, [ttsTextSize]);

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
    if (ttsSettings.engine !== 'local' || availableVoices.length === 0 || !isMountedRef.current) return;

    const currentVoiceIsValid = availableVoices.some(v => v.voiceURI === ttsSettings.voiceURI);

    if (currentVoiceIsValid) {
        const selectedVoice = availableVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
        if (selectedVoice && selectedVoice.lang !== ttsSettings.language) {
             setTtsSettings(prev => ({...prev, language: selectedVoice.lang}));
        }
        return; 
    }
    
    const defaultVoice =
        availableVoices.find(v => v.lang === ttsSettings.language && v.default) || 
        availableVoices.find(v => v.lang === ttsSettings.language) || 
        availableVoices.find(v => v.default && v.lang) || 
        availableVoices[0]; 

    if (defaultVoice) {
        setTtsSettings(prev => ({
            ...prev,
            voiceURI: defaultVoice.voiceURI,
            language: defaultVoice.lang,
        }));
    }
  }, [ttsSettings.engine, ttsSettings.voiceURI, ttsSettings.language, availableVoices]);

  useEffect(() => {
      LocalStorageService.saveTTSSettings(ttsSettings);
  }, [ttsSettings]);


  useEffect(() => {
    const player = new Audio(); audioPlayerRef.current = player;
    const handleAudioEnded = () => { 
        if (audioPlayerRef.current === player && isSpeaking && isMountedRef.current) {
          if (ttsSettings.engine === 'local') {
          } else if (ttsSettings.engine === 'cloud' && isSpeakingRef.current) {
            segmentIndexRef.current++;
            if (isMountedRef.current) _startSpeech('main', 0, true); 
          }
        }
    };
    const handleAudioPlaying = () => { if (audioPlayerRef.current === player && ttsSettings.engine === 'cloud' && isSpeaking && isMountedRef.current) { setIsLoadingTTS(false); } };
    const handleAudioError = () => { if (audioPlayerRef.current === player && isSpeaking && isMountedRef.current) { toast({variant: "destructive", title: "Audio Error", description: "Failed to play audio."}); stopSpeech(true); } };
    player.addEventListener('ended', handleAudioEnded); player.addEventListener('playing', handleAudioPlaying); player.addEventListener('error', handleAudioError);
    return () => {
        player.removeEventListener('ended', handleAudioEnded); player.removeEventListener('playing', handleAudioPlaying); player.removeEventListener('error', handleAudioError);
        if (player.src && !player.paused) player.pause(); player.src = "";
        if (audioPlayerRef.current === player) audioPlayerRef.current = null;
    };
  }, [ttsSettings.engine, isSpeaking, stopSpeech, toast]);

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


  const _startSpeech = useCallback(async (origin: SpeechOrigin, startIndex = 0, _isContinuing = false) => {
    if (!_isContinuing) {
        const textToPlay = currentTextForTTS?.trim();
        if (!textToPlay) {
            toast({variant: "destructive", title: "No Text", description: "No text is available to be read aloud."});
            stopSpeech(true);
            return;
        }
        
        const invalidMessages = ["loading...", "performing ocr..."];
        if(invalidMessages.some(msg => textToPlay.toLowerCase().includes(msg))) {
            toast({variant: "destructive", title: "Cannot Play", description: "Please wait for the current action to complete."});
            stopSpeech(true);
            return;
        }
        stopSpeech(false);
        setIsSpeaking(true);
        isSpeakingRef.current = true;
        setIsPaused(false);
        setSpeechOrigin(origin);
        
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
    }
    
    if (!isSpeakingRef.current || segmentIndexRef.current >= textSegments.length) {
        if (isMountedRef.current) stopSpeech(true);
        return;
    }
    
    if (isMountedRef.current) setIsLoadingTTS(true);

    const currentIndex = segmentIndexRef.current;
    const segmentText = textSegments[currentIndex].replace(PUNCTUATION_REGEX, ' ').trim();

    if (!segmentText) { 
        segmentIndexRef.current++;
        _startSpeech(origin, 0, true);
        return;
    }
    
    if (isMountedRef.current) setHighlightedSegmentIndex(currentIndex);

    if (ttsSettings.engine === 'local') {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
            stopSpeech(true);
            return;
        }
        const utterance = new SpeechSynthesisUtterance(segmentText);
        utterance.lang = ttsSettings.language;
        utterance.pitch = ttsSettings.pitch;
        utterance.rate = ttsSettings.rate;
        const systemVoices = window.speechSynthesis.getVoices();
        let voiceToUse = systemVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
        if (voiceToUse) utterance.voice = voiceToUse;

        utterance.onend = () => {
            segmentIndexRef.current++;
            setTimeout(() => _startSpeech(origin, 0, true), 50); 
        };
        utterance.onerror = (event) => {
            if (isMountedRef.current && event.error !== 'canceled' && event.error !== 'interrupted') {
                console.error("SpeechSynthesis Error:", event.error);
                toast({ variant: "destructive", title: "TTS Error", description: event.error || "An unknown error occurred." });
                stopSpeech(true);
            }
        };
        utteranceRef.current = utterance;
        if(isMountedRef.current) setIsLoadingTTS(false);
        window.speechSynthesis.speak(utterance);
    } else { 
      try {
        const result = await getCloudSpeech(segmentText, ttsSettings.language, ttsSettings.cloudVoiceId);
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
  }, [ttsSettings, stopSpeech, toast, textSegments, currentTextForTTS]);

  const speakTextOnce = useCallback(async (text: string) => {
    stopSpeech(true); 

    const cleanedText = text.replace(PUNCTUATION_REGEX, ' ').trim();
    if (!cleanedText) {
        toast({ title: 'No Text to Speak', description: 'Your selection contains only punctuation.' });
        return;
    }
    
    setIsLoadingTTS(true);

    if (ttsSettings.engine === 'local') {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
            setIsLoadingTTS(false); return;
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
        utterance.onend = () => { if(isMountedRef.current) setIsLoadingTTS(false); };
        utterance.onerror = (event) => {
            if (isMountedRef.current && event.error !== 'canceled' && event.error !== 'interrupted') {
                toast({ variant: "destructive", title: "TTS Error", description: event.error || "Speech failed." });
                setIsLoadingTTS(false);
            }
        };
        setTimeout(() => { if(isMountedRef.current) window.speechSynthesis.speak(utterance); }, 50);
    } else { 
      try {
        const result = await getCloudSpeech(cleanedText, ttsSettings.language, ttsSettings.cloudVoiceId);
        if (!isMountedRef.current) return;
        if ('audioUrl' in result && audioPlayerRef.current) {
          audioPlayerRef.current.src = result.audioUrl;
          await audioPlayerRef.current.play();
        } else if ('error' in result) {
          toast({ variant: "destructive", title: "Cloud TTS Error", description: result.error });
        }
      } catch (error: any) {
        if (!isMountedRef.current) return;
        toast({ variant: "destructive", title: "Cloud TTS Failed", description: error.message });
      } finally {
        if (isMountedRef.current) setIsLoadingTTS(false);
      }
    }
  }, [ttsSettings, availableVoices, stopSpeech, toast]);

  const playPauseSpeech = () => {
    if (!isMountedRef.current) return;
    
    if (isSpeaking) {
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
      const selectionInfo = getSelectedText();
      const startIndex = selectionInfo?.startIndex ?? 0;
      _startSpeech('main', startIndex);
    }
  };
  
  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    if(!isMountedRef.current) return;
    stopSpeech(true);

    setTtsSettings(prev => {
        let newSettings = { ...prev };

        if (key === 'voiceURI' && value) {
            const selectedVoice = availableVoices.find(v => v.voiceURI === value);
            if (selectedVoice) {
                newSettings.voiceURI = selectedVoice.voiceURI;
                newSettings.language = selectedVoice.lang;
            }
        } else {
            (newSettings[key] as any) = value;
        }
        
        if (key === 'engine') {
            newSettings.type = value as 'local' | 'cloud';
            if (value === 'cloud') {
                const currentLang = newSettings.language;
                const cloudLangData = edgeTTSLanguageVoices[currentLang];
                if (!cloudLangData) {
                    const defaultLocale = 'en-US';
                    newSettings.language = defaultLocale;
                    newSettings.cloudVoiceId = edgeTTSLanguageVoices[defaultLocale].voices[0].id;
                } else if (!newSettings.cloudVoiceId?.startsWith(currentLang)) {
                    newSettings.cloudVoiceId = cloudLangData.voices[0].id;
                }
            } else if (value === 'local') {
                const currentVoice = availableVoices.find(v => v.voiceURI === newSettings.voiceURI);
                if (!currentVoice) {
                    const defaultVoice = availableVoices.find(v => v.default) || availableVoices[0];
                    if (defaultVoice) {
                        newSettings.voiceURI = defaultVoice.voiceURI;
                        newSettings.language = defaultVoice.lang;
                    }
                }
            }
        }
        
        if (key === 'language' && newSettings.engine === 'cloud') {
            const newLang = value as string;
            const langVoices = edgeTTSLanguageVoices[newLang]?.voices;
            if (langVoices && langVoices.length > 0) {
                newSettings.cloudVoiceId = langVoices[0].id;
            } else {
                newSettings.cloudVoiceId = undefined;
            }
        }

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

  const handleViewScaleChange = (newScale: number) => { 
      if (isRenderingPdfPage || isLoadingDoc) return; 
      stopSpeech(true); 
      setViewScale(newScale); 
  };

  const navigateEpub = async (direction: 'prev' | 'next') => {
    const rendition = epubRenditionRef.current;
    if (!rendition || isEpubLoading || isEpubPaginating) return;
    stopSpeech(true);

    try {
        if (direction === 'prev') {
            await rendition.prev();
        } else {
            await rendition.next();
        }
    } catch (error) {
        console.warn(`[EPUB Nav] Error during rendition.${direction}():`, error);
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
    setScratchpadAnnotations([]);
    setCurrentTextForTTS('');
    LocalStorageService.clearScratchpad();
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

    if (isSpeaking && speechOrigin === 'main') {
      return isPaused 
        ? { text: "Resume", icon: <Play className="mr-1 h-4 w-4" />, disabled: false, variant: "default" as const } 
        : { text: "Pause", icon: <Pause className="mr-1 h-4 w-4" />, disabled: false, variant: "outline" as const };
    }
    
    // Check if there's a text selection to determine button text
    if (typeof window !== 'undefined' && window.getSelection()?.toString().trim().length) {
      return { text: "Play from Selection", icon: <Play className="mr-1 h-4 w-4" />, disabled: false, variant: "default" as const }
    }
    
    return { text: "Play Text", icon: <Play className="mr-1 h-4 w-4" />, disabled: false, variant: "default" as const };
  };

  const openJumpDialog = (type: 'pdf' | 'epub', currentPage: number, totalPages: number) => {
    if (type === 'pdf' && totalPages <= 0) return;
    if (type === 'epub' && !isEpubReadyForJumping) {
      toast({ variant: "default", title: "EPUB Info", description: "Pagination is still calculating. Please try again shortly." });
      return;
    }
    
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
        variant: 'destructive',
        title: 'Invalid Page Number',
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
        const bookInstance = epubBookRef.current;
        if (bookInstance && epubRenditionRef.current && isEpubReadyForJumping && pageNum !== epubCurrentPageNum) {
             const percentage = (pageNum - 1) / totalPages;
            if (typeof percentage === 'number' && percentage >= 0 && percentage <= 1) {
                stopSpeech(true);
                epubRenditionRef.current.display(percentage);
            } else {
                 toast({ variant: "destructive", title: "Jump Failed", description: "Could not find the location for the specified page." });
            }
        }
    }
    handleCancelJump();
  };
  
  const handleOpenAnnotationDialog = () => {
    const selectionInfo = getSelectedText();
    if (!selectionInfo.text.trim()) {
      toast({
        variant: 'destructive',
        title: 'No Text Selected',
        description: 'Please select text to add a note.',
      });
      return;
    }
    if (selectionInfo.startIndex === null) {
      toast({
        variant: 'destructive',
        title: 'Selection Error',
        description: 'Could not determine the precise location of the selected text. Please try again.',
      });
      return;
    }

    let pageNum: number;
    if (activeDoc?.type === 'pdf' && !isPdfTextView) pageNum = currentPdfPageNum;
    else if (activeDoc?.type === 'epub') pageNum = epubCurrentPageNum;
    else if (activeDoc) pageNum = 1;
    else pageNum = 1; // For scratchpad

    // CRITICAL: Lock the selection info into state here
    setSelectionForAnnotation({
        text: selectionInfo.text,
        startIndex: selectionInfo.startIndex,
        pageNumber: pageNum,
    });

    setAnnotationDialog({
      open: true,
      id: null,
      note: '',
      imageDataUrl: '',
      isSaving: false,
    });
  };

  const handleAnnotationImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setAnnotationDialog((prev) => ({
          ...prev,
          imageDataUrl: event.target?.result as string,
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveAnnotation = async () => {
    setAnnotationDialog((prev) => ({ ...prev, isSaving: true }));
    try {
      if (!selectionForAnnotation || selectionForAnnotation.startIndex === null) {
        throw new Error("Could not get valid selection info to save annotation.");
      }
  
      const { id, note, imageDataUrl } = annotationDialog;
      const { text, startIndex, pageNumber } = selectionForAnnotation;
  
      if (activeDoc && pageNumber === undefined) {
        throw new Error("Cannot save annotation without a page number for a document.");
      }

      const newOrUpdatedAnnotation: Annotation = {
        id: id || `ann_${Date.now()}`,
        pageNumber: pageNumber!,
        targetText: text,
        startIndex: startIndex,
        note,
        imageDataUrl: imageDataUrl || '',
        createdAt: id ? (activeDoc?.annotations?.find(a => a.id === id) || scratchpadAnnotations.find(a => a.id === id))?.createdAt || Date.now() : Date.now(),
      };
  
      if (activeDoc) {
        let updatedAnnotations;
        if (id) {
          updatedAnnotations = (activeDoc.annotations || []).map(ann => ann.id === id ? newOrUpdatedAnnotation : ann);
        } else {
          updatedAnnotations = [...(activeDoc.annotations || []), newOrUpdatedAnnotation];
        }
        const updatedDoc = { ...activeDoc, annotations: updatedAnnotations };
        await IndexedDBService.saveDocument(updatedDoc);
        setActiveDoc(updatedDoc);
      } else { // Scratchpad
        let updatedAnnotations;
        if (id) {
          updatedAnnotations = scratchpadAnnotations.map(ann => ann.id === id ? newOrUpdatedAnnotation : ann);
        } else {
          updatedAnnotations = [...scratchpadAnnotations, newOrUpdatedAnnotation];
        }
        setScratchpadAnnotations(updatedAnnotations);
      }
      toast({ title: id ? 'Annotation Updated' : 'Annotation Saved' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to Save', description: e.message });
    } finally {
      setAnnotationDialog({ open: false, id: null, note: '', imageDataUrl: '', isSaving: false });
      setSelectionForAnnotation(null); // Clear the locked selection after saving
    }
  };
  

  const performDeleteAnnotation = async () => {
    if (!annotationToDelete) return;
    const annotationId = annotationToDelete.id;

    try {
        if (activeDoc) {
            const updatedAnnotations = activeDoc.annotations?.filter(a => a.id !== annotationId);
            const updatedDoc = { ...activeDoc, annotations: updatedAnnotations };
            await IndexedDBService.saveDocument(updatedDoc);
            setActiveDoc(updatedDoc);
        } else { // Scratchpad
            const updatedAnnotations = scratchpadAnnotations.filter(a => a.id !== annotationId);
            setScratchpadAnnotations(updatedAnnotations);
        }
        setViewingAnnotation(null);
        toast({ title: 'Annotation Deleted' });
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Failed to Delete', description: e.message });
    } finally {
        setAnnotationToDelete(null); // Close the dialog
    }
  };


  const handleDeleteAnnotation = (annotation: Annotation) => {
    setAnnotationToDelete(annotation);
  };

  const handleFavoriteAnnotation = (annotation: Annotation) => {
    const noteFavorite: NoteFavoriteItem = {
      id: annotation.id,
      annotation: annotation,
      sourceDocumentId: activeDoc?.id || 'scratchpad',
      sourceDocumentName: activeDoc?.title || 'Scratchpad',
      favoritedAt: Date.now(),
    }
    LocalStorageService.saveNoteFavorite(noteFavorite);
    toast({ title: 'Note Favorited', description: 'Saved to your notes favorites page.' });
  };
  
  const handleEditAnnotation = (annotation: Annotation) => {
    setViewingAnnotation(null);
    setSelectionForAnnotation({
        text: annotation.targetText,
        startIndex: annotation.startIndex,
        pageNumber: annotation.pageNumber,
    });
    setAnnotationDialog({
      open: true,
      id: annotation.id,
      note: annotation.note,
      imageDataUrl: annotation.imageDataUrl || '',
      isSaving: false,
    });
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

  const showViewControls = activeDoc?.type && ['pdf', 'image', 'epub', 'txt'].includes(activeDoc.type);
  const groupedLocalVoices = groupVoicesByLanguage(availableVoices);


  return (
    <>
      <div className="flex flex-col lg:flex-row w-full h-[calc(100vh-4rem)]">
        <div className="flex-grow flex flex-col bg-muted/20 p-2 md:p-4 min-w-0">
          
          <div className="flex-grow flex flex-col min-h-0">
            <Card className="flex-grow flex flex-col min-h-0 shadow-inner">
              <CardContent ref={scrollContainerRef} className="flex-grow p-2 md:p-4 overflow-auto">
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
                
                <div 
                  className="w-full h-full p-2 md:p-4 flex flex-col items-center justify-start"
                  style={{
                    transform: `scale(${viewScale})`,
                    transformOrigin: 'top center',
                    transition: 'transform 0.2s ease-out'
                  }}
                >
                  {!activeDoc && !isLoadingDoc && !docErrorMessage && (
                     <div className="w-full h-full">
                        <Textarea 
                            ref={mainTextAreaRef}
                            className="w-full h-full min-h-[200px] whitespace-pre-wrap select-text text-sm resize-none" 
                            value={scratchpadText}
                            onChange={(e) => setScratchpadText(e.target.value)}
                            placeholder="Welcome to the Scratchpad! Type or paste your text here..."
                        />
                     </div>
                  )}

                  {activeDoc?.type === 'pdf' && isPdfTextView && (
                    <div className="w-full h-full px-3 py-2 text-sm">
                        {renderedTextWithAnnotations}
                    </div>
                  )}


                  {activeDoc?.type === 'pdf' && !isPdfTextView && (
                      <div className="w-full text-center space-y-4">
                          {pdfPageImage && <NextImage src={pdfPageImage} alt={`Page ${currentPdfPageNum}`} width={0} height={0} style={{ width: 'auto', height: 'auto', maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} className="shadow-lg border rounded-md" />}
                      </div>
                  )}
                  
                  <div id="epub-container" className={cn("w-full h-full flex flex-col items-center", activeDoc?.type !== 'epub' && "hidden")}>
                      <div
                          key={docId || 'epub-placeholder'}
                          id="epub-viewer"
                          ref={epubViewerRef}
                          className="w-full flex-grow"
                      />
                  </div>

                  {activeDoc?.type === 'txt' && (
                    <div className="w-full h-full px-3 py-2 text-sm max-h-[calc(100vh-24rem)] overflow-auto">
                        {renderedTextWithoutAnnotations}
                    </div>
                  )}


                  {activeDoc?.type === 'image' && displayedImageSrc && (
                      <div className="w-full text-center space-y-4">
                          <NextImage src={displayedImageSrc} alt={activeDoc.title || 'Uploaded Image'} width={800} height={600} style={{objectFit: 'contain'}} className="max-w-full max-h-[calc(100%-4rem)] shadow-lg border rounded-md inline-block" data-ai-hint="illustration abstract" />
                      </div>
                  )}
                </div>
                {activeDoc?.type === 'mobi' && ( <div className="p-4 bg-background rounded-md shadow-inner text-center h-full flex flex-col justify-center items-center"> <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2"/> <p className="font-semibold">MOBI Not Supported</p> <p className="text-sm text-muted-foreground">Please convert to EPUB or PDF.</p> </div> )}
              </CardContent>
            </Card>
          </div>

          <div className="flex-shrink-0 pt-2">
              <Card className="shadow-md">
                  <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3">
                      <CardTitle className="text-sm flex items-center"><FileText className="mr-2 h-4 w-4"/> Current Text for TTS</CardTitle>
                      <div className="flex items-center gap-2">
                            <Button
                                onClick={() => setIsTtsAreaExpanded(!isTtsAreaExpanded)}
                                size="icon"
                                variant="outline"
                                className="h-9 w-9"
                                title={isTtsAreaExpanded ? "Shrink TTS Area" : "Expand TTS Area"}
                            >
                                {isTtsAreaExpanded ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
                            </Button>
                          
                            <Button
                                onClick={handleOpenAnnotationDialog}
                                size="icon"
                                variant="outline"
                                className="h-9 w-9"
                                title="Add Annotation"
                            >
                                <MessageSquarePlus className="h-4 w-4" />
                            </Button>
                          
                          {(showOcrButtonForPdfPage || showOcrButtonForImage || showOcrButtonForEpubPage) && (
                              <Button
                                  onClick={handlePerformOcr}
                                  disabled={isPerformingOcr}
                                  size="icon"
                                  variant="outline"
                                  className="h-9 w-9"
                                  title={activeDoc?.type === 'image' ? 'OCR Image' : 'OCR Page'}
                              >
                                  {isPerformingOcr ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
                              </Button>
                          )}
                          <Popover>
                              <PopoverTrigger asChild>
                                  <Button variant="outline" size="icon" className="h-9 w-9">
                                      <CaseSensitive className="h-4 w-4" />
                                      <span className="sr-only">Set font size</span>
                                  </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-56" align="end">
                                  <div className="space-y-2">
                                      <Label htmlFor="tts-font-size" className="text-sm">Font Size: {ttsTextSize}px</Label>
                                      <Slider
                                          id="tts-font-size"
                                          min={10}
                                          max={32}
                                          step={1}
                                          value={[ttsTextSize]}
                                          onValueChange={([v]) => setTtsTextSize(v)}
                                      />
                                  </div>
                              </PopoverContent>
                          </Popover>
                      </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                      <div ref={ttsBoxHighlightedContentRef} className={cn("w-full px-3 py-2 border rounded-md bg-muted/30 overflow-y-auto whitespace-pre-wrap select-text transition-all duration-300 ease-in-out", isTtsAreaExpanded ? "h-64" : "h-20")} style={{ fontSize: `${ttsTextSize}px` }}>
                        {isSpeaking || isPaused ? speakingViewContent : renderedTextWithAnnotations}
                      </div>
                  </CardContent>
              </Card>
          </div>
        </div>

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

              {activeDoc?.type === 'pdf' && !isPdfTextView && pdfTotalPages > 0 && (
                <Card>
                  <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">PDF Navigation</CardTitle></CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    <div className="flex items-center justify-between">
                      <Button onClick={() => navigatePdf('prev')} disabled={isLoadingDoc || isRenderingPdfPage || currentPdfPageNum <= 1} size="sm" variant="outline" aria-label="Previous Page"><ChevronLeft /></Button>
                      <Button variant="ghost" className="h-9 tabular-nums" onClick={() => openJumpDialog('pdf', currentPdfPageNum, pdfTotalPages)}>
                          {currentPdfPageNum} / {pdfTotalPages}
                      </Button>
                      <Button onClick={() => navigatePdf('next')} disabled={isLoadingDoc || isRenderingPdfPage || currentPdfPageNum >= pdfTotalPages} size="sm" variant="outline" aria-label="Next Page"><ChevronRight /></Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeDoc?.type === 'epub' && (
                <Card>
                  <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">EPUB Navigation</CardTitle></CardHeader>
                  <CardContent className="flex items-center justify-between pt-0">
                      <Button onClick={() => navigateEpub('prev')} size="sm" variant="outline" disabled={isEpubLoading || isEpubPaginating} aria-label="Previous Page"><ChevronLeft /></Button>
                      
                      {isEpubPaginating ? (
                        <span className="text-sm text-muted-foreground px-2 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Page info loading...</span>
                      ) : epubTotalPages > 0 ? (
                        <Button variant="ghost" className="h-9 tabular-nums" onClick={() => openJumpDialog('epub', epubCurrentPageNum, epubTotalPages)}>
                            {epubCurrentPageNum} / {epubTotalPages}
                        </Button>
                      ) : (
                        <span className="text-sm text-muted-foreground px-2">No page info</span>
                      )}
                      
                      <Button onClick={() => navigateEpub('next')} size="sm" variant="outline" disabled={isEpubLoading || isEpubPaginating} aria-label="Next Page"><ChevronRight /></Button>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm flex items-center gap-1"><Settings2 className="h-4 w-4"/> Text-to-Speech</CardTitle></CardHeader>
                <CardContent className="space-y-3 pt-2">
                  <div className="grid grid-cols-2 gap-2">
                      <Button 
                        onClick={playPauseSpeech} 
                        disabled={mainButtonState.disabled} 
                        variant={mainButtonState.variant} 
                        className="w-full text-xs col-span-2 h-9"
                      >
                        {mainButtonState.icon} {mainButtonState.text}
                      </Button>
                      <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="w-full" title="Favorite Text">
                        <Star />
                      </Button>
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
                        className="w-full" 
                        disabled={isLoadingTTS}
                        title="Repeat Selection"
                      > 
                        <Repeat />
                      </Button>
                  </div>

                  <Separator className="my-3" />

                  <div className="space-y-2">
                      <Label htmlFor="tts-engine" className="text-xs">Engine</Label>
                      <Select value={ttsSettings.engine} onValueChange={(v) => handleSettingChange('engine', v as 'local' | 'cloud')} disabled={isSpeaking && !isPaused}>
                        <SelectTrigger id="tts-engine" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="local"><div className="flex items-center gap-1 text-xs"><Smartphone className="h-3 w-3"/>Local</div></SelectItem><SelectItem value="cloud"><div className="flex items-center gap-1 text-xs"><CloudIcon className="h-3 w-3"/>Cloud</div></SelectItem></SelectContent>
                      </Select>
                  </div>

                  {ttsSettings.engine === 'local' && (
                    <div className="space-y-2">
                      <Label htmlFor="tts-voice" className="text-xs">Voice (Local)</Label>
                      <Select 
                        value={ttsSettings.voiceURI || ""} 
                        onValueChange={(v) => handleSettingChange('voiceURI', v)} 
                        disabled={isSpeaking && !isPaused || availableVoices.length === 0}
                      >
                        <SelectTrigger id="tts-voice" className="h-9 text-xs"><SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No local voices available"} /></SelectTrigger>
                        <SelectContent className="max-h-48">
                            {availableVoices.length === 0 ? (
                                <SelectItem value="no-voices" disabled>No local voices found on this device</SelectItem>
                            ) : (
                                Object.entries(groupedLocalVoices).map(([lang, voices]) => (
                                    <SelectGroup key={lang}>
                                        <SelectLabel className="text-xs">{lang}</SelectLabel>
                                        {voices.map(voice => (
                                            <SelectItem key={voice.voiceURI} value={voice.voiceURI} className="text-xs">{voice.name}</SelectItem>
                                        ))}
                                    </SelectGroup>
                                ))
                            )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  
                  {ttsSettings.engine === 'cloud' && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="cloud-tts-language" className="text-xs">Language (Cloud)</Label>
                        <Select value={ttsSettings.language} onValueChange={(v) => handleSettingChange('language', v as string)} disabled={isSpeaking && !isPaused}>
                            <SelectTrigger id="cloud-tts-language" className="h-9 text-xs"><SelectValue placeholder="Select a language" /></SelectTrigger>
                            <SelectContent className="max-h-48">
                                {Object.entries(edgeTTSLanguageVoices).map(([locale, { language }]) => (
                                    <SelectItem key={locale} value={locale} className="text-xs">{language} ({locale})</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                          <Label htmlFor="cloud-tts-voice" className="text-xs">Voice (Cloud)</Label>
                          <Select value={ttsSettings.cloudVoiceId || ""} onValueChange={(v) => handleSettingChange('cloudVoiceId', v)} disabled={isSpeaking && !isPaused || !ttsSettings.language}>
                              <SelectTrigger id="cloud-tts-voice" className="h-9 text-xs"><SelectValue placeholder="Select a voice" /></SelectTrigger>
                              <SelectContent className="max-h-48">
                                  {(edgeTTSLanguageVoices[ttsSettings.language]?.voices || []).map(voice => (
                                      <SelectItem key={voice.id} value={voice.id} className="text-xs">{voice.name}</SelectItem>
                                  ))}
                              </SelectContent>
                          </Select>
                      </div>
                    </>
                  )}

                  <div className="space-y-1 pt-2">
                    <Label htmlFor="tts-rate" className="text-xs">Rate: {ttsSettings.rate.toFixed(1)}</Label>
                    <Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={isSpeaking && !isPaused}/>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tts-pitch" className="text-xs">Pitch: {ttsSettings.pitch.toFixed(1)}</Label>
                    <Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={isSpeaking && !isPaused}/>
                  </div>
                </CardContent>
              </Card>
              
              {showViewControls && (
                  <Card>
                    <CardHeader className="pb-2 pt-3"><CardTitle className="text-sm">View Controls</CardTitle></CardHeader>
                    <CardContent className="space-y-2 pt-0">
                      <div className="flex items-center gap-2">
                        <Button onClick={() => handleViewScaleChange(viewScale - 0.25)} size="icon" variant="outline" className="h-7 w-7" disabled={isRenderingPdfPage || viewScale <= 0.25}><ZoomOut className="h-4 w-4"/></Button>
                        <Slider value={[viewScale]} min={0.25} max={5} step={0.25} onValueChange={([val]) => handleViewScaleChange(val)} disabled={isRenderingPdfPage} />
                        <Button onClick={() => handleViewScaleChange(viewScale + 0.25)} size="icon" variant="outline" className="h-7 w-7" disabled={isRenderingPdfPage || viewScale >= 5}><ZoomIn className="h-4 w-4"/></Button>
                      </div>
                      {activeDoc?.type === 'pdf' && (
                        <div className="pt-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="w-full"
                            onClick={() => {
                              stopSpeech(true);
                              setIsPdfTextView(prev => !prev);
                            }}
                            disabled={isLoadingDoc || isRenderingPdfPage || !pdfTextContent}
                          >
                           {isPdfTextView ? "Switch to Image View" : "Switch to Text View"}
                          </Button>
                        </div>
                       )}
                    </CardContent>
                  </Card>
              )}

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

        <AlertDialog
          open={annotationDialog.open}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setAnnotationDialog((p) => ({ ...p, open: false }));
              setSelectionForAnnotation(null); // Clear locked selection on dialog close
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{annotationDialog.id ? 'Edit Annotation' : 'Add Annotation'}</AlertDialogTitle>
              <AlertDialogDescription>
                Add a note and an optional image for the selected text.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="annotation-note">Your Note</Label>
                <Textarea
                  id="annotation-note"
                  placeholder="Type your note here..."
                  value={annotationDialog.note}
                  onChange={(e) => setAnnotationDialog((p) => ({ ...p, note: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="annotation-image">Attach Image (Optional)</Label>
                <Input
                  id="annotation-image"
                  type="file"
                  accept="image/*"
                  ref={annotationImageInputRef}
                  onChange={handleAnnotationImageUpload}
                />
              </div>
              {annotationDialog.imageDataUrl && (
                <div className="relative group">
                  <p className="text-sm font-medium mb-1">Image Preview:</p>
                  <img src={annotationDialog.imageDataUrl} alt="Annotation preview" className="max-h-32 rounded-md border" />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-0 right-0 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => {
                      setAnnotationDialog((p) => ({ ...p, imageDataUrl: '' }));
                      if(annotationImageInputRef.current) annotationImageInputRef.current.value = "";
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleSaveAnnotation} disabled={annotationDialog.isSaving}>
                {annotationDialog.isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={!!viewingAnnotation} onOpenChange={(isOpen) => !isOpen && setViewingAnnotation(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Annotation Details</DialogTitle>
              <DialogDescription>
                Note for: <span className="italic">&quot;{viewingAnnotation?.targetText}&quot;</span>
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto">
              {viewingAnnotation?.note && (
                <div className="p-3 bg-muted/50 rounded-md">
                    <p className="text-sm whitespace-pre-wrap">{viewingAnnotation.note}</p>
                </div>
              )}
              {viewingAnnotation?.imageDataUrl && (
                <div>
                    <img src={viewingAnnotation.imageDataUrl} alt="Annotation attachment" className="rounded-md border max-w-full" />
                </div>
              )}
            </div>
            <DialogFooter className="gap-2 sm:justify-end">
                <Button variant="outline" size="sm" onClick={() => {
                  if (viewingAnnotation) {
                    handleEditAnnotation(viewingAnnotation);
                  }
                }}>
                    <Pencil className="mr-2 h-4 w-4" /> Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => viewingAnnotation && handleFavoriteAnnotation(viewingAnnotation)}>
                  <Star className="mr-2 h-4 w-4" /> Favorite
                </Button>
                <Button variant="destructive" size="sm" onClick={() => viewingAnnotation && handleDeleteAnnotation(viewingAnnotation)}>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!annotationToDelete} onOpenChange={(isOpen) => !isOpen && setAnnotationToDelete(null)}>
          <AlertDialogContent>
              <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the annotation for
                  <span className="font-bold italic"> &quot;{annotationToDelete?.targetText}&quot;</span>.
              </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={performDeleteAnnotation}>
                  Continue
              </AlertDialogAction>
              </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
}

const DynamicReaderPageContent = dynamic(() => Promise.resolve(ReaderPageContent), {
  ssr: false,
  loading: () => <div className="flex h-screen w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>,
});


export default function ReaderPage() {
    return (
        <AuthGuard>
            <DynamicReaderPageContent />
        </AuthGuard>
    )
}
