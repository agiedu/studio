
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ActiveMangaDocument, MangaImageFile, MangaPdfFile, MangaSubPage, TTSSettings, TTSVoice, FavoriteItem, StoredMangaDocument } from '@/types';
import { performOCR, getCloudSpeech } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import NextImage from 'next/image'; // Renamed to avoid conflict with local Image variable if any
import { Cloud, Loader2, Play, Pause, Smartphone, BookOpen, ChevronLeft, ChevronRight, Star, Trash2, Image as ImageIcon, UploadCloud, ServerCrash, Save, RefreshCw } from 'lucide-react';
import * as LocalStorageService from '@/lib/localStorageService';
import * as IndexedDBService from '@/lib/indexedDBService';
import { uploadFileToLocalServer } from '@/lib/localFileService';
import { cn } from '@/lib/utils';

import { GlobalWorkerOptions, getDocument, version as pdfjsVersion } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';


function base64ToUint8Array(base64: string): Uint8Array {
  try {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    console.error("Failed to decode Base64 string:", e);
    throw new Error("Invalid Base64 string provided. The file might be corrupted or not a valid PDF.");
  }
}

// Helper to convert ArrayBuffer to a temporary blob URL for display
function arrayBufferToBlobURL(buffer: ArrayBuffer, type: string): string {
  const blob = new Blob([buffer], { type });
  return URL.createObjectURL(blob);
}

export function MangaRoom() {
  const { toast } = useToast();

  const [activeDocument, setActiveDocument] = useState<ActiveMangaDocument | null>(null);
  const [currentPdfInternalPageIndex, setCurrentPdfInternalPageIndex] = useState(0);
  const [jumpToPageInput, setJumpToPageInput] = useState('');

  const [ttsSettings, setTtsSettings] = useState<TTSSettings>(LocalStorageService.defaultTTSSettings);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false); // For initial file processing
  const [isLoadingPdfPage, setIsLoadingPdfPage] = useState(false); // For PDF page rendering
  const [isSyncingToLocal, setIsSyncingToLocal] = useState(false); // For local helper service sync

  const [isLoadingTTS, setIsLoadingTTS] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPausedState, setIsPausedState] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);

  const [sentenceSegments, setSentenceSegments] = useState<string[]>([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number>(-1);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const pdfDocCacheRef = useRef<Record<string, PDFDocumentProxy>>({}); // Cache PDFDocumentProxy by ArrayBuffer reference or a generated ID if ArrayBuffer changes
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeDocDisplayUrlRef = useRef<string | null>(null); // For blob URLs

  const stopSpeech = useCallback((resetUIState = true) => {
    if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    } else if (audioPlayerRef.current) {
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
    if(resetUIState) {
        setIsSpeaking(false);
        setIsPausedState(false);
        setIsLoadingTTS(false);
        setCurrentSentenceIndex(-1);
        setSentenceSegments([]);
    }
  }, [ttsSettings.type]);

  const stopSpeechFnRef = useRef(stopSpeech);
  useEffect(() => {
    stopSpeechFnRef.current = stopSpeech;
  }, [stopSpeech]);

  const loadDocumentFromStoredData = useCallback(async (storedDoc: StoredMangaDocument) => {
    setIsLoadingDocument(true);
    try {
      if (activeDocDisplayUrlRef.current) {
        URL.revokeObjectURL(activeDocDisplayUrlRef.current);
        activeDocDisplayUrlRef.current = null;
      }

      if (storedDoc.type === 'image') {
        const displayUrl = arrayBufferToBlobURL(storedDoc.fileData, storedDoc.originalType);
        activeDocDisplayUrlRef.current = displayUrl;
        setActiveDocument({
          id: storedDoc.id,
          title: storedDoc.title,
          type: 'image',
          fileData: storedDoc.fileData,
          originalType: storedDoc.originalType,
          imageDataUrl: displayUrl,
          extractedText: storedDoc.extractedText,
          createdAt: storedDoc.createdAt,
        });
      } else if (storedDoc.type === 'pdf') {
        const pdfInstance = await getDocument({ data: storedDoc.fileData.slice(0) }).promise;
        pdfDocCacheRef.current[storedDoc.id] = pdfInstance;
        const initialPageIndex = LocalStorageService.loadCurrentPdfPageIndexForDoc(storedDoc.id) || 0;

        setActiveDocument({
          id: storedDoc.id,
          title: storedDoc.title,
          type: 'pdf',
          fileData: storedDoc.fileData,
          originalType: storedDoc.originalType,
          numPages: pdfInstance.numPages,
          // processedPages are for display and will be populated by renderAndProcessPdfPage
          processedPages: new Array(pdfInstance.numPages).fill(null).map(() => ({ imageDataUrl: '', extractedText: undefined })),
          createdAt: storedDoc.createdAt,
        });
        setCurrentPdfInternalPageIndex(initialPageIndex);
        setJumpToPageInput((initialPageIndex + 1).toString());
      }
      await IndexedDBService.saveLastActiveDocId(storedDoc.id);
    } catch (error: any) {
      console.error("Error loading document from StoredData:", error);
      toast({ variant: "destructive", title: "Error Loading Document", description: `Failed to load ${storedDoc.title || 'document'} from browser storage. ${error.message}` });
      setActiveDocument(null);
    } finally {
      setIsLoadingDocument(false);
    }
  }, [toast]);


  useEffect(() => {
    if (typeof window !== 'undefined') {
      GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
      setTtsSettings(LocalStorageService.loadTTSSettings());

      IndexedDBService.getLastActiveDocId().then(docId => {
        if (docId) {
          IndexedDBService.getDocumentById(docId).then(storedDoc => {
            if (storedDoc) {
              loadDocumentFromStoredData(storedDoc);
            }
          });
        }
      });
    }

    return () => { // Cleanup blob URL
      if (activeDocDisplayUrlRef.current) {
        URL.revokeObjectURL(activeDocDisplayUrlRef.current);
      }
    };
  }, [loadDocumentFromStoredData]);

  useEffect(() => {
    LocalStorageService.saveTTSSettings(ttsSettings);
  }, [ttsSettings]);

  useEffect(() => {
    if (activeDocument && activeDocument.type === 'pdf' && activeDocument.id) {
        LocalStorageService.saveCurrentPdfPageIndexForDoc(activeDocument.id, currentPdfInternalPageIndex);
    }
  }, [activeDocument, currentPdfInternalPageIndex]);


  const populateVoiceList = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const voices = window.speechSynthesis.getVoices().map(v => ({
        name: v.name,
        lang: v.lang,
        voiceURI: v.voiceURI,
        localService: v.localService,
        default: v.default,
      }));
      setAvailableVoices(voices);
      const currentSettings = LocalStorageService.loadTTSSettings();
      if (!currentSettings.voiceURI && voices.length > 0) {
        const defaultVoice = voices.find(v => v.lang === currentSettings.language && v.default) || voices.find(v => v.lang === currentSettings.language) || voices.find(v => v.default) || voices[0];
        if (defaultVoice) {
          const newSettings = { ...currentSettings, voiceURI: defaultVoice.voiceURI, language: defaultVoice.lang };
          setTtsSettings(newSettings);
        }
      } else {
         setTtsSettings(currentSettings);
      }
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
      stopSpeechFnRef.current(true);
    };
  }, [populateVoiceList]);

  const renderAndProcessPdfPage = useCallback(async (doc: MangaPdfFile, pageNumToRender: number) => {
    if (!doc || doc.type !== 'pdf' || pageNumToRender < 0 || pageNumToRender >= doc.numPages ) {
      setIsLoadingPdfPage(false);
      return;
    }
    setIsLoadingPdfPage(true);
    stopSpeechFnRef.current(true);
    setSentenceSegments([]);
    setCurrentSentenceIndex(-1);

    setActiveDocument(prevDoc => {
        if (prevDoc && prevDoc.id === doc.id && prevDoc.type === 'pdf') {
            const updatedProcessedPages = [...prevDoc.processedPages];
            const existingPageData = updatedProcessedPages[pageNumToRender];
            updatedProcessedPages[pageNumToRender] = {
                imageDataUrl: existingPageData?.imageDataUrl || '', // Keep existing image if re-processing text
                extractedText: "Loading PDF page content..."
            };
            return { ...prevDoc, processedPages: updatedProcessedPages } as MangaPdfFile;
        }
        return prevDoc;
    });

    try {
      let pdfDocInstance = pdfDocCacheRef.current[doc.id];
      if (!pdfDocInstance) {
        // Re-create from ArrayBuffer if not in cache (e.g., after page refresh and load from IDB)
        pdfDocInstance = await getDocument({ data: doc.fileData.slice(0) }).promise;
        pdfDocCacheRef.current[doc.id] = pdfDocInstance;
      }

      const page: PDFPageProxy = await pdfDocInstance.getPage(pageNumToRender + 1); // PDF.js pages are 1-indexed
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      let imageDataUrl = '';

      if (activeDocDisplayUrlRef.current && doc.processedPages[pageNumToRender]?.imageDataUrl === activeDocDisplayUrlRef.current) {
        // If the current display URL is for this page, no need to revoke, it's the same
      } else if (activeDocDisplayUrlRef.current) {
        URL.revokeObjectURL(activeDocDisplayUrlRef.current); // Revoke previous page's blob URL
        activeDocDisplayUrlRef.current = null;
      }

      if (context) {
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        // Create a blob URL for the current page image for display
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (blob) {
            imageDataUrl = URL.createObjectURL(blob);
            activeDocDisplayUrlRef.current = imageDataUrl;
        } else {
            throw new Error("Canvas toBlob returned null");
        }
      }


      let textForPage: string;
      const textContent = await page.getTextContent();
      const directText = textContent.items.map(item => ('str' in item ? item.str : '')).join(" ").trim();

      if (directText.length > 1) {
        textForPage = directText;
      } else {
        setActiveDocument(prevD => {
          if (prevD && prevD.id === doc.id && prevD.type === 'pdf') {
              const updatedPages = [...prevD.processedPages];
              updatedPages[pageNumToRender] = {
                  imageDataUrl: imageDataUrl || updatedPages[pageNumToRender]?.imageDataUrl || '',
                  extractedText: "Extracting text using OCR..."
              };
              return { ...prevD, processedPages: updatedPages } as MangaPdfFile;
          }
          return prevD;
        });
        if (imageDataUrl) { // Needs actual image data, not just a URL if it's a canvas drawing
            const canvasImageForOCR = canvas.toDataURL('image/png'); // Use direct data URL for OCR
            const ocrResult = await performOCR(canvasImageForOCR);
            textForPage = 'extractedText' in ocrResult ? ocrResult.extractedText : "OCR failed or no text found.";
            if ('error' in ocrResult && ocrResult.error) {
                toast({ variant: "destructive", title: "OCR Error on PDF Page", description: ocrResult.error });
            }
        } else {
            textForPage = "Could not render PDF page for OCR (no image data).";
        }
      }

      setActiveDocument(prevD => {
        if (prevD && prevD.id === doc.id && prevD.type === 'pdf') {
          const updatedPages = [...prevD.processedPages];
          updatedPages[pageNumToRender] = { imageDataUrl, extractedText: textForPage };
          return { ...prevD, processedPages: updatedPages } as MangaPdfFile;
        }
        return prevD;
      });

    } catch (error: any) {
      console.error("Error processing PDF page:", error);
      const errorMsg = error.message || `Failed to process page ${pageNumToRender + 1}.`;
      toast({ variant: "destructive", title: "PDF Page Error", description: errorMsg });
       setActiveDocument(prevD => {
          if (prevD && prevD.id === doc.id && prevD.type === 'pdf') {
            const updatedPages = [...prevD.processedPages];
            const currentImage = (prevD.processedPages && prevD.processedPages[pageNumToRender]?.imageDataUrl) || '';
            updatedPages[pageNumToRender] = { imageDataUrl: currentImage, extractedText: `Error processing page: ${errorMsg}`};
            return { ...prevD, processedPages: updatedPages } as MangaPdfFile;
          }
          return prevD;
        });
    } finally {
      setIsLoadingPdfPage(false);
    }
  }, [toast, stopSpeechFnRef]);


  useEffect(() => {
    if (activeDocument?.type === 'pdf' && activeDocument.numPages > 0 && currentPdfInternalPageIndex >= 0 && currentPdfInternalPageIndex < activeDocument.numPages) {
      setJumpToPageInput((currentPdfInternalPageIndex + 1).toString());
      const currentPageData = activeDocument.processedPages[currentPdfInternalPageIndex];
      if (
          (
            !currentPageData ||
            !currentPageData.imageDataUrl || // Image must be present for the page to be considered "processed" for display
            currentPageData.extractedText === undefined || // Text extraction attempt should have happened
            currentPageData.extractedText?.startsWith("Error:") ||
            currentPageData.extractedText?.startsWith("Loading PDF page content...") ||
            currentPageData.extractedText?.startsWith("Extracting text using OCR...")
          ) && !isLoadingPdfPage
         ) {
         renderAndProcessPdfPage(activeDocument as MangaPdfFile, currentPdfInternalPageIndex);
      }
    } else if (activeDocument?.type === 'image') {
      setJumpToPageInput('');
    } else if (!activeDocument) {
      setJumpToPageInput('');
    }
  }, [activeDocument, currentPdfInternalPageIndex, isLoadingPdfPage, renderAndProcessPdfPage]);


  let currentSubPage: MangaSubPage | null | undefined = null;
  let textToRead = "";

  if (activeDocument) {
    if (activeDocument.type === 'image') {
      textToRead = activeDocument.extractedText || "";
      if (activeDocument.extractedText === "Performing OCR..." || activeDocument.extractedText === "Processing uploaded image...") {
          textToRead = "Please wait, processing image...";
      }
      currentSubPage = {imageDataUrl: activeDocument.imageDataUrl || '', extractedText: activeDocument.extractedText};
    } else if (activeDocument.type === 'pdf' && activeDocument.processedPages && currentPdfInternalPageIndex >= 0 && currentPdfInternalPageIndex < activeDocument.numPages) {
      currentSubPage = activeDocument.processedPages[currentPdfInternalPageIndex];
      textToRead = currentSubPage?.extractedText || "";

      if (isLoadingPdfPage && !currentSubPage?.imageDataUrl && (!currentSubPage?.extractedText || currentSubPage.extractedText === "Loading PDF page content...")) {
         textToRead = "Loading PDF page content...";
      } else if (currentSubPage?.extractedText === "Extracting text using OCR...") {
         textToRead = "Please wait, extracting text using OCR...";
      } else if (currentSubPage?.extractedText === "Loading PDF page content...") {
         textToRead = "Loading PDF page content...";
      } else if (!isLoadingPdfPage && currentSubPage?.imageDataUrl && (currentSubPage.extractedText === undefined || currentSubPage.extractedText === "")) {
         textToRead = "Page processed. No text extracted or OCR failed. Select text manually if image shows text.";
      } else if (currentSubPage?.extractedText?.startsWith("Error:")) {
         textToRead = currentSubPage.extractedText;
      }
    } else if (activeDocument.type === 'pdf' && (currentPdfInternalPageIndex < 0 || currentPdfInternalPageIndex >= activeDocument.numPages)){
        textToRead = "Invalid page index.";
    }
  }

  const attemptSyncToLocalDevice = async (docToSync: StoredMangaDocument) => {
      if (!docToSync.fileData || !docToSync.title || !docToSync.originalType) {
          toast({variant: "destructive", title: "Sync Error", description: "Document data is incomplete for syncing."});
          return;
      }
      setIsSyncingToLocal(true);
      toast({ title: "Syncing to Local Device", description: `Attempting to send "${docToSync.title}" to your local helper service...` });

      try {
        const file = new File([docToSync.fileData], docToSync.title, { type: docToSync.originalType });
        const formDataForLocalService = new FormData();
        formDataForLocalService.append('file', file);

        const localUploadResult = await uploadFileToLocalServer(formDataForLocalService);

        if (localUploadResult && localUploadResult.success && localUploadResult.filePath) {
            toast({ title: "Synced to Local Device", description: `"${docToSync.title}" successfully sent. Path: ${localUploadResult.filePath}` });
        } else {
            let description = `Could not sync "${docToSync.title}" to local device. Ensure the helper service is running.`;
            if (localUploadResult && typeof localUploadResult === 'object' && Object.keys(localUploadResult).length === 0) {
              description = `Sync of "${docToSync.title}" failed: The application received an empty response from the server. Check Next.js server console and helper service logs.`;
            } else if (localUploadResult && localUploadResult.message) {
              description = `Sync of "${docToSync.title}" failed: ${localUploadResult.message}`;
            }
            toast({ variant: "destructive", title: "Local Sync Failed", description });
            console.error(`[MangaRoom] Local sync failed for "${docToSync.title}". Server Action Response:`, localUploadResult);
        }
      } catch (uploadError: any) {
          const clientErrorMsg = uploadError.message || "An unknown error occurred while trying to sync the file.";
          toast({ variant: "destructive", title: "Local Sync Service Error", description: clientErrorMsg });
          console.error(`[MangaRoom] Error calling uploadFileToLocalServer action for sync of "${docToSync.title}":`, uploadError);
      } finally {
          setIsSyncingToLocal(false);
      }
  };


  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoadingDocument(true);
    stopSpeechFnRef.current(true);
    setSentenceSegments([]);
    setCurrentSentenceIndex(-1);
    setActiveDocument(null); // Clear previous document
     if (activeDocDisplayUrlRef.current) { // Revoke old blob URL
        URL.revokeObjectURL(activeDocDisplayUrlRef.current);
        activeDocDisplayUrlRef.current = null;
    }
    pdfDocCacheRef.current = {}; // Clear PDF cache

    const docId = `doc_${Date.now()}`;
    let storedDocForIndexDB: StoredMangaDocument | null = null;

    try {
      const fileBuffer = await file.arrayBuffer();

      if (file.type.startsWith('image/')) {
        const displayUrl = arrayBufferToBlobURL(fileBuffer, file.type);
        activeDocDisplayUrlRef.current = displayUrl;

        // Set initial active document for display while OCR runs
        const initialActiveImageDoc: MangaImageFile = {
            id: docId,
            title: file.name,
            type: 'image',
            fileData: fileBuffer,
            originalType: file.type,
            imageDataUrl: displayUrl,
            extractedText: "Performing OCR...",
            createdAt: Date.now(),
        };
        setActiveDocument(initialActiveImageDoc);

        let ocrText = "OCR pending...";
        let ocrErrorOccurred = false;
        try {
            // For OCR, we need a data URL, not a blob URL, if performOCR expects that.
            const dataUrlForOcr = await IndexedDBService.arrayBufferToBase64DataURL(fileBuffer, file.type);
            const ocrResult = await performOCR(dataUrlForOcr);
            ocrText = 'extractedText' in ocrResult ? ocrResult.extractedText : (ocrResult.error || "OCR processing failed.");
            if ('error' in ocrResult && ocrResult.error) {
                ocrErrorOccurred = true;
                toast({ variant: "destructive", title: "OCR Error during upload", description: ocrText });
            }
        } catch (ocrCatchError: any) {
           ocrErrorOccurred = true;
           ocrText = `OCR failed: ${ocrCatchError.message || "Unknown OCR error."}`;
           toast({ variant: "destructive", title: "OCR Processing Error", description: ocrText });
        }

        storedDocForIndexDB = {
            id: docId, title: file.name, type: 'image', fileData: fileBuffer, originalType: file.type,
            extractedText: ocrErrorOccurred ? `OCR Error: ${ocrText}` : ocrText, createdAt: Date.now()
        };
        // Update active document with final OCR text
        setActiveDocument(prev => prev?.id === docId ? {...prev, extractedText: storedDocForIndexDB?.extractedText } as MangaImageFile : prev);

      } else if (file.type === 'application/pdf') {
        const pdfLoadingTask = getDocument({ data: fileBuffer.slice(0) }); // Use a copy for getDocument
        const pdfInstance = await pdfLoadingTask.promise;
        pdfDocCacheRef.current[docId] = pdfInstance;

        storedDocForIndexDB = {
            id: docId, title: file.name, type: 'pdf', fileData: fileBuffer, originalType: file.type,
            numPages: pdfInstance.numPages, createdAt: Date.now()
        };
        // The active document will be fully set up by loadDocumentFromStoredData after saving to IDB
      } else {
        toast({ variant: "destructive", title: "Unsupported File", description: "Please upload an Image or PDF file." });
        setIsLoadingDocument(false);
        return;
      }

      if (storedDocForIndexDB) {
        await IndexedDBService.saveDocument(storedDocForIndexDB);
        toast({ title: "Document Saved to Browser", description: `"${file.name}" is saved in your browser and available offline.` });
        await loadDocumentFromStoredData(storedDocForIndexDB); // This sets activeDocument correctly
        await IndexedDBService.saveLastActiveDocId(docId); // Save as last active

        // Attempt to sync to local device (secondary action)
        attemptSyncToLocalDevice(storedDocForIndexDB);
      }

    } catch (error: any) {
      console.error(`[MangaRoom] File Processing/Saving Error for "${file.name}":`, error);
      toast({ variant: "destructive", title: "Processing Error", description: error.message || "Failed to process or save file in browser." });
      setActiveDocument(null);
    } finally {
      setIsLoadingDocument(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };


  const playSpeech = async () => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const effectiveTextToRead = selectedText || textToRead;

    if (!effectiveTextToRead || isLoadingPdfPage || !activeDocument ||
        effectiveTextToRead.startsWith("Error:") ||
        effectiveTextToRead.startsWith("Processing") ||
        effectiveTextToRead.startsWith("Loading") ||
        effectiveTextToRead.startsWith("Please wait") ||
        effectiveTextToRead.startsWith("Extracting text")) {
      toast({ variant: "destructive", title: "No Text", description: "No valid text available to read or page is still processing." });
      setIsLoadingTTS(false);
      setIsSpeaking(false);
      return;
    }

    setIsLoadingTTS(true);
    stopSpeechFnRef.current(false);
    await new Promise(resolve => setTimeout(resolve, 150));

    setIsSpeaking(true);
    setIsPausedState(false);

    if (ttsSettings.type === 'local') {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
        stopSpeechFnRef.current(true); return;
      }

      const utterance = new SpeechSynthesisUtterance(effectiveTextToRead);
      utterance.lang = ttsSettings.language;
      utterance.pitch = ttsSettings.pitch;
      utterance.rate = ttsSettings.rate;

      const selectedVoice = availableVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
      if (selectedVoice) {
        const browserVoice = window.speechSynthesis.getVoices().find(v => v.voiceURI === selectedVoice.voiceURI);
        if (browserVoice) utterance.voice = browserVoice;
      }

      const segments = effectiveTextToRead.match(/[^.!?]+[.!?]*|[^.!?]+/g) || [];
      setSentenceSegments(segments);
      setCurrentSentenceIndex(0);

      utterance.onboundary = (event) => {
        let cumulativeLength = 0;
        let newIdx = -1;
        for (let i = 0; i < segments.length; i++) {
          if (event.charIndex >= cumulativeLength && event.charIndex < cumulativeLength + segments[i].length) {
            newIdx = i;
            break;
          }
          cumulativeLength += segments[i].length;
        }
        if (newIdx !== -1 && utteranceRef.current === utterance) {
            setCurrentSentenceIndex(newIdx);
        }
      };

      utterance.onend = () => {
        if (utteranceRef.current === utterance) stopSpeechFnRef.current(true);
      };
      utterance.onerror = (event) => {
         if (utteranceRef.current === utterance) {
            toast({ variant: "destructive", title: "TTS Error", description: event.error || "Failed to play speech." });
            stopSpeechFnRef.current(true);
        }
      };
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
      setIsLoadingTTS(false);

    } else {
      setSentenceSegments([]);
      setCurrentSentenceIndex(-1);
      try {
        const cloudResult = await getCloudSpeech(effectiveTextToRead, ttsSettings.language);
        if ('audioUrl' in cloudResult && audioPlayerRef.current) {
            audioPlayerRef.current.src = cloudResult.audioUrl;
            await audioPlayerRef.current.play();
        } else if ('error' in cloudResult) {
          toast({ variant: "destructive", title: "Cloud TTS Error", description: cloudResult.error });
          stopSpeechFnRef.current(true);
        } else {
            throw new Error("Invalid response from cloud TTS");
        }
      } catch (error: any) {
        toast({ variant: "destructive", title: "Cloud TTS Request Failed", description: error.message || "Unknown error." });
        stopSpeechFnRef.current(true);
      }
    }
  };

  const pauseSpeech = () => {
    if (isSpeaking && !isPausedState) {
        if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
          window.speechSynthesis.pause();
          setIsPausedState(true);
        } else if (audioPlayerRef.current && !audioPlayerRef.current.paused) {
          audioPlayerRef.current.pause();
          setIsPausedState(true);
        }
    }
  };

  const resumeSpeech = () => {
    if (isSpeaking && isPausedState) {
        if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
            if (window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
                setIsPausedState(false);
                setTimeout(() => {
                    if (utteranceRef.current && isSpeaking && !isPausedState && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
                        stopSpeechFnRef.current(true);
                    }
                }, 100);
            } else {
                 stopSpeechFnRef.current(true);
            }
        }
        else if (ttsSettings.type === 'cloud' && audioPlayerRef.current && audioPlayerRef.current.paused) {
            audioPlayerRef.current.play().catch(e => {
                toast({variant: "destructive", title: "Resume Error", description: "Could not resume audio."});
                stopSpeechFnRef.current(true);
            });
            setIsPausedState(false);
        }
    }
  };

  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;

    const handleAudioEnded = () => stopSpeechFnRef.current(true);
    const handleAudioPlaying = () => {
        if (ttsSettings.type === 'cloud' && isSpeaking) {
            setIsLoadingTTS(false);
            setIsPausedState(false);
        }
    };

    const handleAudioError = (e: Event) => {
      const audioElement = e.target as HTMLAudioElement;
      let errorMessage = "Failed to load or play audio.";
      if (audioElement.error) {
        switch (audioElement.error.code) {
          case MediaError.MEDIA_ERR_ABORTED: errorMessage = "Audio playback aborted."; break;
          case MediaError.MEDIA_ERR_NETWORK: errorMessage = "A network error caused audio download to fail."; break;
          case MediaError.MEDIA_ERR_DECODE: errorMessage = "Audio playback aborted due to a corruption problem or because the media used features your browser did not support."; break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: errorMessage = "The audio could not be loaded, either because the server or network failed or because the format is not supported."; break;
          default: errorMessage = "An unknown error occurred with the audio player.";
        }
      }
      toast({variant: "destructive", title: "Audio Error", description: errorMessage});
      stopSpeechFnRef.current(true);
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
  }, [ttsSettings.type, isSpeaking, toast]);


  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    stopSpeechFnRef.current(true);
    setTtsSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      if (key === 'language' && newSettings.type === 'local') {
        const suitableVoice = availableVoices.find(v => v.lang === value && v.default) || availableVoices.find(v => v.lang === value);
        if (suitableVoice) {
            newSettings.voiceURI = suitableVoice.voiceURI;
        } else {
            newSettings.voiceURI = undefined;
        }
      }
      return newSettings;
    });

    if (key === 'type') {
      setSentenceSegments([]);
      setCurrentSentenceIndex(-1);
    }
  };

  const navigatePdfPage = (direction: 'next' | 'prev') => {
    stopSpeechFnRef.current(true);
    const doc = activeDocument;
    if (!doc || doc.type !== 'pdf' ) return;

    let newPdfPage = currentPdfInternalPageIndex;
    if (direction === 'next') {
      if (currentPdfInternalPageIndex < doc.numPages - 1) {
        newPdfPage = currentPdfInternalPageIndex + 1;
      }
    } else {
      if (currentPdfInternalPageIndex > 0) {
        newPdfPage = currentPdfInternalPageIndex - 1;
      }
    }
    if (newPdfPage !== currentPdfInternalPageIndex) {
      setCurrentPdfInternalPageIndex(newPdfPage);
    }
  };

  const handleJumpToPageOnBlur = () => {
    const doc = activeDocument;
    let resetValue = '';
    if (doc && doc.type === 'pdf' && doc.numPages > 0 && currentPdfInternalPageIndex >= 0 && currentPdfInternalPageIndex < doc.numPages) {
      resetValue = (currentPdfInternalPageIndex + 1).toString();
    }

    const pageNumFromInputText = parseInt(jumpToPageInput, 10);
    if (doc && doc.type === 'pdf' && doc.numPages > 0) {
        if (isNaN(pageNumFromInputText) || pageNumFromInputText < 1 || pageNumFromInputText > doc.numPages) {
             setJumpToPageInput(resetValue || '1');
        }
    } else {
      setJumpToPageInput(resetValue);
    }
  };

  const handleClearActiveDocument = async () => {
    stopSpeechFnRef.current(true);
    if (activeDocument) {
       await IndexedDBService.saveLastActiveDocId(null); // Clear last active
    }
    if (activeDocDisplayUrlRef.current) {
        URL.revokeObjectURL(activeDocDisplayUrlRef.current);
        activeDocDisplayUrlRef.current = null;
    }
    setActiveDocument(null);
    setCurrentPdfInternalPageIndex(0);
    setJumpToPageInput('');
    setSentenceSegments([]);
    setCurrentSentenceIndex(-1);
    pdfDocCacheRef.current = {};
    toast({title: "Session Document Cleared", description: "The current document has been cleared from this session."});
     if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  }

  const handleFavoriteSelection = () => {
    const selection = window.getSelection()?.toString().trim();
    const currentDocForFavorite = activeDocument;
    if (selection && currentDocForFavorite) {
      const newFavorite: FavoriteItem = {
        id: Date.now().toString(),
        text: selection,
        sourceDocumentId: currentDocForFavorite.id,
        sourceDocumentName: currentDocForFavorite.title || "Untitled Document",
        createdAt: Date.now(),
      };
      LocalStorageService.addFavoriteItem(newFavorite);
      toast({ title: "Favorited!", description: `"${selection.substring(0, 30)}..." added to favorites.` });
    } else if (!selection) {
      toast({ variant: "destructive", title: "No Selection", description: "Please select text to favorite." });
    } else if (!currentDocForFavorite) {
      toast({ variant: "destructive", title: "Cannot Favorite", description: "No active document to associate with the favorite." });
    }
  };


  const getPlayButtonState = () => {
    const selectedTextContent = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const hasValidTextToRead = textToRead &&
                              !textToRead.startsWith("Error:") &&
                              !textToRead.startsWith("Processing") &&
                              !textToRead.startsWith("Loading") &&
                              !textToRead.startsWith("Please wait") &&
                              !textToRead.startsWith("Extracting text");

    const canPlay = (!!selectedTextContent || hasValidTextToRead) &&
                    !isLoadingPdfPage &&
                    !isLoadingDocument && // Check isLoadingDocument here
                    activeDocument &&
                    !(activeDocument.type === 'image' && activeDocument.extractedText === "Performing OCR...") &&
                    !(activeDocument.type === 'image' && activeDocument.extractedText === "Processing uploaded image...") &&
                    !(activeDocument.type === 'pdf' && currentSubPage?.extractedText?.startsWith("Loading")) &&
                    !(activeDocument.type === 'pdf' && currentSubPage?.extractedText?.startsWith("Extracting")) &&
                    !(activeDocument.type === 'pdf' && currentSubPage?.extractedText?.startsWith("Processing"));


    if (isLoadingTTS) return { icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, text: "Loading...", action: () => {}, disabled: true, variant: "default" as const };

    if (isSpeaking) {
        if (isPausedState) {
            return { icon: <Play className="mr-1 h-4 w-4" />, text: "Resume", action: resumeSpeech, disabled: !canPlay, variant: "outline" as const};
        }
        return { icon: <Pause className="mr-1 h-4 w-4" />, text: "Pause", action: pauseSpeech, disabled: !canPlay, variant: "outline" as const};
    }
    return {
        icon: <Play className="mr-1 h-4 w-4" />,
        text: selectedTextContent ? "Play Selected" : "Play All",
        action: playSpeech,
        disabled: !canPlay,
        variant: "default" as const
    };
  };

  const playButtonState = getPlayButtonState();

  const currentImageToDisplay = activeDocument?.type === 'image' ? activeDocument.imageDataUrl :
                               activeDocument?.type === 'pdf' && currentSubPage ? currentSubPage.imageDataUrl : null;


  return (
    <div className="flex flex-col w-full p-4 md:p-6 space-y-6">
       <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Upload Document</CardTitle>
          <CardDescription>
            Upload an image or PDF. It will be saved in your browser for this session and offline use.
            You can also sync it to your local device via the helper service.
            <span className="font-semibold text-destructive block mt-1"> IMPORTANT: For permanent, cross-session local device storage, your local helper service (e.g., `server.js`) MUST be running. Otherwise, files are only stored in this browser.</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full max-w-md items-center gap-1.5">
            <Label htmlFor="manga-room-file-upload">Document File (Image or PDF)</Label>
            <Input
              id="manga-room-file-upload"
              type="file"
              accept="image/*,application/pdf"
              onChange={handleFileUpload}
              ref={fileInputRef}
              disabled={isLoadingDocument || isSyncingToLocal}
            />
          </div>
          {isLoadingDocument && <p className="mt-2 text-sm text-muted-foreground">Processing and saving file to browser: {fileInputRef.current?.files?.[0]?.name || "New file"}...</p>}
        </CardContent>
      </Card>

      <div className="flex-grow space-y-6">
          {activeDocument && !isLoadingDocument && (
            <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex-grow min-w-0">
                    <CardTitle className="truncate text-xl" title={activeDocument.title || "Untitled Document"}>
                        Reading: {activeDocument.title || "Untitled Document"} ({activeDocument.type.toUpperCase()})
                    </CardTitle>
                    <CardDescription className="text-xs">Saved in browser. Created: {new Date(activeDocument.createdAt).toLocaleString()}</CardDescription>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                    {activeDocument.fileData && ( // Only show sync if we have the data
                         <Button variant="outline" size="sm" onClick={() => attemptSyncToLocalDevice(activeDocument as StoredMangaDocument)} disabled={isSyncingToLocal || isLoadingDocument}>
                            {isSyncingToLocal ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Sync to Device
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={handleClearActiveDocument} disabled={isLoadingPdfPage || isLoadingTTS || isSpeaking || isLoadingDocument || isSyncingToLocal}>
                        <Trash2 className="h-4 w-4 mr-1" /> Clear
                    </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="relative aspect-[2/3] w-full mx-auto bg-muted rounded-md overflow-hidden shadow-inner">
                  {(isLoadingPdfPage && activeDocument.type==='pdf' && (!currentImageToDisplay)) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10">
                        <Loader2 className="h-12 w-12 animate-spin text-primary" />
                        <p className="mt-2 text-muted-foreground">Loading PDF page image...</p>
                    </div>
                  )}
                  {currentImageToDisplay ? (
                    <NextImage
                      src={currentImageToDisplay}
                      alt={activeDocument.title || `Page content`}
                      fill
                      style={{ objectFit: "contain" }}
                      data-ai-hint="manga page comic"
                      priority={true}
                      key={`${activeDocument.id}-${activeDocument.type==='pdf' ? currentPdfInternalPageIndex : 'image'}-${currentImageToDisplay.substring(currentImageToDisplay.length - 20)}`}
                      onLoadingComplete={(img) => {
                        // If it's a blob URL for a PDF page that just loaded, we might not need to revoke it immediately
                        // if it's the active page. Revocation is handled by renderAndProcessPdfPage or unmount.
                        if (activeDocument.type === 'image' && activeDocument.imageDataUrl?.startsWith('blob:')) {
                           // For image type, if it's a blob, it was created from fileData and is fine.
                        }
                      }}
                    />
                  ) : activeDocument.type === 'pdf' && !isLoadingPdfPage && activeDocument.numPages > 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                      <BookOpen className="w-16 h-16 text-primary mb-4" />
                      <p className="font-semibold">{activeDocument.title || 'PDF Document'}</p>
                      <p className="text-sm text-muted-foreground">
                        { activeDocument.numPages > 0 ? `Page ${currentPdfInternalPageIndex + 1} of ${activeDocument.numPages}. Waiting to process...` : "Empty PDF or error loading."}
                      </p>
                       {isLoadingPdfPage && <Loader2 className="h-6 w-6 animate-spin text-primary mt-2" />}
                       {!isLoadingPdfPage && activeDocument.numPages > 0 && (!currentSubPage?.imageDataUrl || currentSubPage?.extractedText?.startsWith("Error:") || currentSubPage?.extractedText === undefined) &&
                         <Button onClick={() => renderAndProcessPdfPage(activeDocument as MangaPdfFile, currentPdfInternalPageIndex)} className="mt-2" size="sm" disabled={isLoadingPdfPage}>Process This Page</Button>
                       }
                      <p className="text-xs text-muted-foreground mt-2">If this takes too long, the page might be complex or an error occurred.</p>
                    </div>
                  ): activeDocument.type === 'image' && !currentImageToDisplay && !isLoadingDocument ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                        <ImageIcon className="w-16 h-16 text-destructive mb-4" />
                        <p>Image data is missing or failed to load for display.</p>
                    </div>
                  ) : (
                     !isLoadingDocument && !activeDocument &&
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                      <ImageIcon className="w-16 h-16 text-primary mb-4" />
                      <p>No document loaded. Please upload a document above to begin.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
             {(textToRead || (isLoadingPdfPage && activeDocument.type === 'pdf' && currentSubPage?.extractedText?.startsWith("Loading")) || (activeDocument.type ==='image' && (activeDocument.extractedText === "Performing OCR..." || activeDocument.extractedText === "Processing uploaded image..."))) && (
                <Card>
                <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-lg">Extracted Text (from browser-stored document)</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                    <div
                        className={cn(
                            "min-h-[100px] max-h-60 overflow-y-auto p-2 border rounded-md bg-muted/30 whitespace-pre-wrap text-sm select-text",
                            textToRead.startsWith("Error:") && "text-destructive bg-destructive/10",
                            (textToRead.startsWith("Processing") || textToRead.startsWith("Loading") || textToRead.startsWith("Please wait") || textToRead.startsWith("Extracting text") ) && "text-muted-foreground italic"
                        )}
                    >
                    {(isLoadingPdfPage && activeDocument.type === 'pdf' && (currentSubPage?.extractedText?.startsWith("Loading") || currentSubPage?.extractedText?.startsWith("Extracting"))) ? (currentSubPage?.extractedText || "Loading page text...") :
                        (activeDocument.type === 'image' && (activeDocument.extractedText === "Performing OCR..." || activeDocument.extractedText === "Processing uploaded image...")) ? (activeDocument.extractedText) :
                        (ttsSettings.type === 'local' && sentenceSegments.length > 0 && isSpeaking && !isPausedState) ? (
                        sentenceSegments.map((segment, index) => (
                            <span
                            key={index}
                            className={cn(
                                "transition-colors duration-150",
                                index === currentSentenceIndex && "text-accent-foreground font-semibold bg-accent/20"
                            )}
                            >
                            {segment}
                            </span>
                        ))
                        ) : (
                        textToRead || "No text extracted or available for this page."
                        )
                    }
                    </div>
                    <Button
                        onClick={handleFavoriteSelection}
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        disabled={
                            !activeDocument ||
                            isLoadingDocument ||
                            isLoadingPdfPage ||
                            (activeDocument.type ==='image' && (activeDocument.extractedText === "Performing OCR..." || activeDocument.extractedText === "Processing uploaded image..." || activeDocument.extractedText === "OCR pending...")) ||
                            (activeDocument.type==='pdf' && (!currentSubPage?.extractedText || currentSubPage.extractedText.startsWith("Loading") || currentSubPage.extractedText.startsWith("Extracting") || currentSubPage.extractedText.startsWith("Error") || currentSubPage.extractedText.startsWith("Processing")  ))
                        }>
                    <Star className="mr-2 h-4 w-4" /> Favorite Selected Text
                    </Button>
                </CardContent>
                </Card>
            )}
            </>
          )}

          {isLoadingDocument && fileInputRef.current?.files?.[0] && <p className="text-sm text-muted-foreground text-center">Processing file for session...</p>}

          {!activeDocument && !isLoadingDocument &&(
             <Card className="text-center">
              <CardHeader>
                <CardTitle>No File Loaded</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-muted-foreground">Upload a document above to begin reading. Documents are saved in your browser.</p>
                 <div className="border border-destructive bg-destructive/5 p-3 rounded-md text-destructive-foreground/90 text-xs mt-3">
                    <div className="flex items-center gap-2 font-semibold text-base text-destructive-foreground">
                        <ServerCrash className="h-5 w-5" /> Important Note on Local Device Syncing:
                    </div>
                    <p className="mt-1.5">
                        Documents uploaded here are saved **in this browser** using IndexedDB for offline access.
                        To also save them to your computer's file system (e.g., "Downloads" or "Documents" folder), you can use the "Sync to Device" button that appears after a document is loaded.
                    </p>
                    <p className="mt-1.5 font-semibold">
                        The "Sync to Device" feature requires your **local helper service** (e.g., a Node.js `server.js` script) to be **RUNNING** on your computer and accessible at `http://localhost:3001/upload`.
                    </p>
                    <p className="mt-1.5">
                       If the local helper service is not running or is inaccessible, the "Sync to Device" will fail, but your document will remain safely stored in this browser.
                       Check the "Library" page for more troubleshooting tips if syncing fails.
                    </p>
                </div>
              </CardContent>
            </Card>
          )}
      </div>

      {activeDocument && !isLoadingDocument && (
        <div className="space-y-4">
            <Card>
            <CardHeader className="p-4">
                <CardTitle className="text-lg">Controls</CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {activeDocument?.type === 'pdf' && activeDocument.numPages > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="pdf-page-jump" className="text-sm">Page Navigation (PDF)</Label>
                  <div className="flex items-center gap-1">
                    <Button
                      onClick={() => navigatePdfPage('prev')}
                      disabled={currentPdfInternalPageIndex === 0 || isLoadingPdfPage || isLoadingTTS || (isSpeaking && !isPausedState)}
                      size="sm"
                      variant="outline"
                      className="px-2 h-8"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Input
                      id="pdf-page-jump"
                      type="text"
                      inputMode="numeric"
                      className="h-8 w-12 text-center text-sm px-1"
                      value={jumpToPageInput}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setJumpToPageInput(newValue);

                        const doc = activeDocument;
                        if (doc && doc.type === 'pdf' && doc.numPages > 0) {
                          const pageNumOneBased = parseInt(newValue, 10);
                          if (!isNaN(pageNumOneBased) && pageNumOneBased >= 1 && pageNumOneBased <= doc.numPages) {
                            const pageNumZeroBased = pageNumOneBased - 1;
                            if (pageNumZeroBased !== currentPdfInternalPageIndex) {
                              stopSpeechFnRef.current(true);
                              setCurrentPdfInternalPageIndex(pageNumZeroBased);
                            }
                          }
                        }
                      }}
                      onBlur={handleJumpToPageOnBlur}
                      disabled={isLoadingPdfPage || isLoadingTTS || (isSpeaking && !isPausedState)}
                    />
                     <Button
                      onClick={() => navigatePdfPage('next')}
                      disabled={currentPdfInternalPageIndex >= activeDocument.numPages - 1 || isLoadingPdfPage || isLoadingTTS || (isSpeaking && !isPausedState)}
                      size="sm"
                      variant="outline"
                      className="px-2 h-8"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">of {activeDocument.numPages}</p>
                </div>
              )}

              {(textToRead || (typeof window !== 'undefined' && window.getSelection()?.toString().trim())) &&
                !isLoadingPdfPage &&
                !textToRead.startsWith("Error:") &&
                !textToRead.startsWith("Processing") &&
                !textToRead.startsWith("Loading") &&
                !textToRead.startsWith("Please wait") &&
                !textToRead.startsWith("Extracting text") &&
                !(activeDocument.type === 'image' && activeDocument.extractedText === "Performing OCR...") &&
                 !(activeDocument.type === 'image' && activeDocument.extractedText === "OCR pending...") &&
                !(activeDocument.type === 'image' && activeDocument.extractedText === "Processing uploaded image...") &&
              (
                <>
                  <hr className="my-3 border-border" />
                  <Label className="text-sm block mb-1">TTS Settings</Label>
                  <div className="flex flex-col gap-3">
                    <div>
                      <Label htmlFor="tts-type" className="text-xs">Engine</Label>
                      <Select value={ttsSettings.type} onValueChange={(v) => handleSettingChange('type', v as 'local' | 'cloud')} disabled={(isSpeaking && !isPausedState) || isLoadingTTS}>
                        <SelectTrigger id="tts-type" className="h-8 text-xs">
                          <SelectValue placeholder="Select TTS type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="local"><div className="flex items-center gap-1 text-xs"><Smartphone className="h-3 w-3" /> Local</div></SelectItem>
                          <SelectItem value="cloud"><div className="flex items-center gap-1 text-xs"><Cloud className="h-3 w-3"/> Cloud</div></SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="tts-language" className="text-xs">Language</Label>
                      <Input
                          id="tts-language"
                          value={ttsSettings.language}
                          onChange={(e) => handleSettingChange('language', e.target.value)}
                          placeholder="e.g. en-US"
                          disabled={(isSpeaking && !isPausedState) || isLoadingTTS || (ttsSettings.type === 'local' && availableVoices.length === 0)}
                          className="h-8 text-xs"
                        />
                    </div>
                  </div>

                  {ttsSettings.type === 'local' && (
                    <div>
                      <Label htmlFor="tts-voice" className="text-xs">Voice (Local)</Label>
                      <Select value={ttsSettings.voiceURI} onValueChange={(v) => handleSettingChange('voiceURI', v)} disabled={(isSpeaking && !isPausedState) || isLoadingTTS || availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0}>
                        <SelectTrigger id="tts-voice" className="h-8 text-xs">
                          <SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No voices available"} />
                        </SelectTrigger>
                        <SelectContent className="max-h-48">
                          {availableVoices.filter(v => v.lang && v.lang.startsWith(ttsSettings.language.split('-')[0])).map(voice => (
                            <SelectItem key={voice.voiceURI || voice.name} value={voice.voiceURI} className="text-xs">
                              {voice.name} ({voice.lang}) {voice.default ? "[Def]" : ""}
                            </SelectItem>
                          ))}
                           {availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (
                                <SelectItem value="no-voice-manga" disabled>{availableVoices.length > 0 ? "No voices for language" : "No local voices"}</SelectItem>
                            )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label htmlFor="tts-rate" className="text-xs">Rate: {ttsSettings.rate.toFixed(1)}</Label>
                    <Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={(isSpeaking && !isPausedState) || isLoadingTTS}/>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tts-pitch" className="text-xs">Pitch: {ttsSettings.pitch.toFixed(1)}</Label>
                    <Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={(isSpeaking && !isPausedState) || isLoadingTTS}/>
                  </div>

                  <div className="flex flex-col items-start gap-2 pt-2">
                    <Button
                        onClick={playButtonState.action}
                        disabled={playButtonState.disabled}
                        variant={playButtonState.variant}
                        className="w-full h-9 text-sm"
                    >
                        {playButtonState.icon} {playButtonState.text}
                    </Button>
                  </div>
                  {(typeof window !== 'undefined' && window.getSelection()?.toString().trim()) && <p className="text-xs text-muted-foreground italic">Reading selection: "{(window.getSelection()?.toString().trim() || "").substring(0,30)}..."</p>}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
