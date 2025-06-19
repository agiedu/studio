
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { MangaDocument, MangaImageFile, MangaPdfFile, MangaSubPage, TTSSettings, TTSVoice, FavoriteItem, StoredImageDocument, StoredPdfDocument, Read2StoredDocument } from '@/types';
import { performOCR, getCloudSpeech } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import Image from 'next/image';
import { Cloud, Loader2, Play, Pause, Smartphone, BookOpen, ChevronLeft, ChevronRight, Star, Trash2, Image as ImageIcon, UploadCloud } from 'lucide-react';
import * as LocalStorage from '@/lib/localStorageService';
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

export function MangaRoom() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeDocument, setActiveDocument] = useState<MangaDocument | null>(null);
  const [currentPdfInternalPageIndex, setCurrentPdfInternalPageIndex] = useState(0);
  const [jumpToPageInput, setJumpToPageInput] = useState('');

  const [ttsSettings, setTtsSettings] = useState<TTSSettings>(LocalStorage.defaultTTSSettings);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false);
  const [isLoadingInitialDoc, setIsLoadingInitialDoc] = useState(true);
  const [isLoadingPdfPage, setIsLoadingPdfPage] = useState(false);
  const [isLoadingTTS, setIsLoadingTTS] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPausedState, setIsPausedState] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);

  const [sentenceSegments, setSentenceSegments] = useState<string[]>([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number>(-1);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const pdfDocCacheRef = useRef<Record<string, PDFDocumentProxy>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);


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

  useEffect(() => {
    if (typeof window !== 'undefined') {
      GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
      setTtsSettings(LocalStorage.loadTTSSettings());
    }
  }, []);


  const loadInitialDocument = useCallback(async () => {
    setIsLoadingInitialDoc(true);
    setIsLoadingDocument(true);
    stopSpeechFnRef.current(true);
    setSentenceSegments([]);
    setCurrentSentenceIndex(-1);
    setActiveDocument(null);
    
    try {
      let docIdToLoad: string | null = null;
      const loadFromLibraryIdQuery = searchParams.get('loadFromLibraryId');
      const sourceQuery = searchParams.get('source'); // 'read2' or 'general'

      if (loadFromLibraryIdQuery) {
        docIdToLoad = loadFromLibraryIdQuery;
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.delete('loadFromLibraryId');
        currentUrl.searchParams.delete('source');
        router.replace(currentUrl.pathname + currentUrl.search, { scroll: false });
      } else {
        docIdToLoad = LocalStorage.loadLastActiveMangaRoomDocId();
      }

      let docToDisplay: MangaDocument | null = null;
      let storedDoc: Read2StoredDocument | StoredImageDocument | StoredPdfDocument | undefined | null = null;

      if (docIdToLoad) {
        if (sourceQuery === 'read2' || (!sourceQuery && LocalStorage.getRead2StoredDocumentById(docIdToLoad))) {
          storedDoc = LocalStorage.getRead2StoredDocumentById(docIdToLoad);
        } else if (sourceQuery === 'general') {
          const generalStoredDoc = LocalStorage.getStoredDocumentById(docIdToLoad);
          if (generalStoredDoc && (generalStoredDoc.type === 'image' || generalStoredDoc.type === 'pdf')) {
            storedDoc = generalStoredDoc as StoredImageDocument | StoredPdfDocument;
          }
        } else if (!sourceQuery) {
           const generalDoc = LocalStorage.getStoredDocumentById(docIdToLoad);
           if (generalDoc && (generalDoc.type === 'image' || generalDoc.type === 'pdf')) {
              storedDoc = generalDoc as StoredImageDocument | StoredPdfDocument;
           } else {
              storedDoc = LocalStorage.getRead2StoredDocumentById(docIdToLoad);
           }
        }

        if (storedDoc) {
          if (LocalStorage.getRead2StoredDocumentById(storedDoc.id)) {
              LocalStorage.saveLastActiveMangaRoomDocId(storedDoc.id);
          }

          if (storedDoc.type === 'image') {
            const storedImageDoc = storedDoc as StoredImageDocument;
            docToDisplay = {
              id: storedImageDoc.id,
              title: storedImageDoc.name,
              type: 'image',
              imageDataUrl: storedImageDoc.imageDataUrl,
              extractedText: storedImageDoc.extractedText || "Performing OCR...",
            };
            setActiveDocument(docToDisplay);
            setIsLoadingDocument(false);

            if (!storedImageDoc.extractedText || storedImageDoc.extractedText === "Performing OCR...") {
              try {
                const ocrResult = await performOCR(storedImageDoc.imageDataUrl);
                const ocrText = 'extractedText' in ocrResult ? ocrResult.extractedText : "OCR failed. Select text manually.";
                
                setActiveDocument(prevDoc => {
                  if (prevDoc && prevDoc.id === storedImageDoc.id && prevDoc.type === 'image') {
                    return { ...prevDoc, extractedText: ocrText };
                  }
                  return prevDoc;
                });
                
                const updatedStoredImageDoc: StoredImageDocument = {...storedImageDoc, extractedText: ocrText };
                if (LocalStorage.getRead2StoredDocumentById(storedImageDoc.id)) {
                   LocalStorage.addRead2StoredDocument(updatedStoredImageDoc);
                } else if (LocalStorage.getStoredDocumentById(storedImageDoc.id)) {
                   LocalStorage.addStoredDocument(updatedStoredImageDoc);
                }
                
                if ('error' in ocrResult && ocrResult.error) {
                  toast({ variant: "destructive", title: "OCR Error on Load", description: ocrResult.error });
                }
              } catch (e: any) {
                toast({ variant: "destructive", title: "Error processing image on load", description: e.message });
                setActiveDocument(prev => prev && prev.id === storedImageDoc.id && prev.type === 'image' ? {...prev, extractedText: `Error during OCR: ${e.message}`} : prev);
              }
            }

          } else if (storedDoc.type === 'pdf') {
            const storedPdfDoc = storedDoc as StoredPdfDocument;
            try {
              if (!pdfDocCacheRef.current[storedPdfDoc.id]) {
                   const pdfBytes = base64ToUint8Array(storedPdfDoc.pdfBase64);
                   const loadingTask = getDocument({data: pdfBytes});
                   pdfDocCacheRef.current[storedPdfDoc.id] = await loadingTask.promise;
              }
              const pdfInstance = pdfDocCacheRef.current[storedPdfDoc.id];

              docToDisplay = {
                id: storedPdfDoc.id,
                title: storedPdfDoc.name,
                type: 'pdf',
                pdfDataUrl: `data:application/pdf;base64,${storedPdfDoc.pdfBase64}`,
                numPages: pdfInstance.numPages,
                processedPages: new Array(pdfInstance.numPages).fill(null).map(() => ({ imageDataUrl: '', extractedText: undefined })),
              };
              setActiveDocument(docToDisplay);
              const savedPageIndex = LocalStorage.loadCurrentPdfPageIndexForDoc(storedPdfDoc.id);
              setCurrentPdfInternalPageIndex(savedPageIndex !== undefined ? savedPageIndex : 0);
              setJumpToPageInput(savedPageIndex !== undefined ? (savedPageIndex+1).toString() : '1');
            } catch (e: any) {
               toast({ variant: "destructive", title: "Error loading PDF", description: e.message });
               setActiveDocument(null);
               if (LocalStorage.getRead2StoredDocumentById(storedDoc.id)) {
                  LocalStorage.saveLastActiveMangaRoomDocId(null);
               }
            } finally {
              setIsLoadingDocument(false);
            }
          }
        } else {
          if (docIdToLoad) {
            toast({ variant: "destructive", title: "Document Not Found", description: `Previously active document (ID: ${docIdToLoad}) no longer in any library.` });
          }
          setActiveDocument(null);
          LocalStorage.saveLastActiveMangaRoomDocId(null);
          setIsLoadingDocument(false);
        }
      } else {
        setActiveDocument(null);
        setIsLoadingDocument(false);
      }
    } catch (error: any) {
        console.error("Critical error during initial document load:", error);
        toast({ variant: "destructive", title: "Initialization Error", description: `Could not initialize the document view: ${error.message || "Unknown error"}. Please try refreshing.`});
        setActiveDocument(null);
        LocalStorage.saveLastActiveMangaRoomDocId(null);
        setIsLoadingDocument(false);
    } finally {
        setIsLoadingInitialDoc(false);
    }
  }, [searchParams, router, toast, stopSpeechFnRef]);

 useEffect(() => {
    loadInitialDocument();
  }, [loadInitialDocument]); 

  useEffect(() => {
    LocalStorage.saveTTSSettings(ttsSettings);
  }, [ttsSettings]);

  useEffect(() => {
    if (activeDocument?.type === 'pdf' && activeDocument.id) {
      LocalStorage.saveCurrentPdfPageIndexForDoc(activeDocument.id, currentPdfInternalPageIndex);
    }
  }, [currentPdfInternalPageIndex, activeDocument]);


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
      const currentSettings = LocalStorage.loadTTSSettings();
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
    if (!doc || doc.type !== 'pdf' || pageNumToRender < 0 || pageNumToRender >= doc.numPages) {
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
                imageDataUrl: existingPageData?.imageDataUrl || '',
                extractedText: "Loading PDF page content..."
            };
            return { ...prevDoc, processedPages: updatedProcessedPages };
        }
        return prevDoc;
    });

    try {
      let pdfDocInstance = pdfDocCacheRef.current[doc.id];
      if (!pdfDocInstance) {
        const storedDocFromRead2 = LocalStorage.getRead2StoredDocumentById(doc.id);
        const storedDocFromGeneral = LocalStorage.getStoredDocumentById(doc.id);
        const storedDoc = storedDocFromRead2 || storedDocFromGeneral;
        
        if (!storedDoc || storedDoc.type !== 'pdf' || !('pdfBase64' in storedDoc && storedDoc.pdfBase64)) {
            const errorMsg = `Corrupted or missing PDF data for ${doc.title}. Please re-upload.`;
            toast({ variant: "destructive", title: "PDF Data Error", description: errorMsg });
            setActiveDocument(prevD => {
              if (prevD && prevD.id === doc.id && prevD.type === 'pdf') {
                const updatedPages = [...prevD.processedPages];
                updatedPages[pageNumToRender] = { imageDataUrl: '', extractedText: `Error: ${errorMsg}`};
                return { ...prevD, processedPages: updatedPages };
              }
              return prevD;
            });
            setIsLoadingPdfPage(false);
            return;
        }
        const base64Data = storedDoc.pdfBase64;
        const pdfBytes = base64ToUint8Array(base64Data);
        const loadingTask = getDocument({data: pdfBytes});
        pdfDocInstance = await loadingTask.promise;
        pdfDocCacheRef.current[doc.id] = pdfDocInstance;
      }

      const page: PDFPageProxy = await pdfDocInstance.getPage(pageNumToRender + 1);

      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      let imageDataUrl = '';
      if (context) {
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        imageDataUrl = canvas.toDataURL('image/png');
      }

      let textForPage: string;
      const textContent = await page.getTextContent();
      const directText = textContent.items.map(item => ('str' in item ? item.str : '')).join(" ").trim();

      if (directText.length > 1) { 
        textForPage = directText;
        setActiveDocument(prevD => {
          if (prevD && prevD.id === doc.id && prevD.type === 'pdf') {
            const updatedPages = [...prevD.processedPages];
            updatedPages[pageNumToRender] = { imageDataUrl, extractedText: textForPage };
            return { ...prevD, processedPages: updatedPages };
          }
          return prevD;
        });
      } else { 
        setActiveDocument(prevD => {
          if (prevD && prevD.id === doc.id && prevD.type === 'pdf') {
              const updatedPages = [...prevD.processedPages];
              updatedPages[pageNumToRender] = {
                  imageDataUrl: imageDataUrl || updatedPages[pageNumToRender]?.imageDataUrl || '',
                  extractedText: "Extracting text using OCR..."
              };
              return { ...prevD, processedPages: updatedPages };
          }
          return prevD;
        });

        if (imageDataUrl) {
          const ocrResult = await performOCR(imageDataUrl);
          textForPage = 'extractedText' in ocrResult ? ocrResult.extractedText : "OCR failed or no text found.";
          if ('error' in ocrResult && ocrResult.error) {
            toast({ variant: "destructive", title: "OCR Error on PDF Page", description: ocrResult.error });
          }
        } else {
          textForPage = "Could not render PDF page for OCR (no image data).";
        }

        setActiveDocument(prevD => {
          if (prevD && prevD.id === doc.id && prevD.type === 'pdf') {
            const updatedPages = [...prevD.processedPages];
            updatedPages[pageNumToRender] = { imageDataUrl, extractedText: textForPage };
            return { ...prevD, processedPages: updatedPages };
          }
          return prevD;
        });
      }
    } catch (error: any) {
      console.error("Error processing PDF page:", error);
      const errorMsg = error.message || `Failed to process page ${pageNumToRender + 1}.`;
      toast({ variant: "destructive", title: "PDF Page Error", description: errorMsg });
       setActiveDocument(prevD => {
          if (prevD && prevD.id === doc.id && prevD.type === 'pdf') {
            const updatedPages = [...prevD.processedPages];
            const currentImage = (prevD.processedPages && prevD.processedPages[pageNumToRender]?.imageDataUrl) || '';
            updatedPages[pageNumToRender] = { imageDataUrl: currentImage, extractedText: `Error processing page: ${errorMsg}`};
            return { ...prevD, processedPages: updatedPages };
          }
          return prevD;
        });
    } finally {
      setIsLoadingPdfPage(false);
    }
  }, [toast]);

  useEffect(() => {
    if (activeDocument?.type === 'pdf' && activeDocument.numPages > 0 && currentPdfInternalPageIndex >= 0 && currentPdfInternalPageIndex < activeDocument.numPages) {
      setJumpToPageInput((currentPdfInternalPageIndex + 1).toString());
      const currentPageData = activeDocument.processedPages[currentPdfInternalPageIndex];
      if (
          (
            !currentPageData ||
            !currentPageData.imageDataUrl ||
            currentPageData.extractedText === undefined ||
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
      currentSubPage = {imageDataUrl: activeDocument.imageDataUrl, extractedText: activeDocument.extractedText};
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

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoadingDocument(true);
    stopSpeechFnRef.current(true);
    setSentenceSegments([]);
    setCurrentSentenceIndex(-1);
    setActiveDocument({
      id: 'temp-loading',
      title: file.name,
      type: file.type.startsWith('image/') ? 'image' : 'pdf',
      // @ts-ignore temp state
      extractedText: file.type.startsWith('image/') ? "Processing uploaded image..." : undefined,
      // @ts-ignore temp state
      processedPages: file.type.startsWith('pdf/') ? [{imageDataUrl:'', extractedText: 'Processing uploaded PDF...'}] : undefined,
    });

    const newDocId = Date.now().toString();
    let documentToSaveToLibrary: StoredImageDocument | StoredPdfDocument;
    let saveToRead2LibrarySuccess = false;

    try {
      if (file.type.startsWith('image/')) {
        const imageDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        let ocrText = "OCR pending...";
        try {
            const ocrResult = await performOCR(imageDataUrl);
            if ('extractedText' in ocrResult) {
                ocrText = ocrResult.extractedText;
            } else {
                ocrText = ocrResult.error || "OCR processing failed.";
                toast({ variant: "destructive", title: "OCR Error during upload", description: ocrText });
            }
        } catch (ocrError: any) {
           toast({ variant: "destructive", title: "OCR Processing Error during upload", description: ocrError.message || "Unknown OCR error." });
           ocrText = `OCR failed: ${ocrError.message || "Unknown OCR error."}`;
        }

        documentToSaveToLibrary = {
          id: newDocId,
          name: file.name,
          type: 'image',
          imageDataUrl: imageDataUrl,
          extractedText: ocrText, 
          createdAt: Date.now(),
        };
        
        saveToRead2LibrarySuccess = LocalStorage.addRead2StoredDocument(documentToSaveToLibrary);

        if (saveToRead2LibrarySuccess) {
          setActiveDocument({ 
            id: newDocId,
            title: file.name,
            type: 'image',
            imageDataUrl,
            extractedText: ocrText,
          });
          LocalStorage.saveLastActiveMangaRoomDocId(newDocId);
          toast({ title: "Image Uploaded", description: `${file.name} added to 'Manga Room Uploads' library & active.` });
        } else {
            toast({ 
                variant: "destructive", 
                title: "Storage Quota Exceeded", 
                description: `Failed to save ${file.name} to Manga Room library. Browser local storage is likely full. Please delete items from the Library page to free up space. This is a browser limitation, not an application bug.`, 
                duration: 10000 
            });
            console.warn(`MangaRoom: Failed to save ${file.name} to Manga Room library due to storage quota. Document not persisted.`);
            if (activeDocument?.id === 'temp-loading') setActiveDocument(null);
        }

      } else if (file.type === 'application/pdf') {
        const pdfDataUrlFull = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const pdfBase64 = pdfDataUrlFull.split(',')[1];
        if (!pdfBase64) throw new Error("Could not read PDF file content for Base64.");

        const pdfBytes = base64ToUint8Array(pdfBase64);
        const pdfLoadingTask = getDocument({ data: pdfBytes });
        const pdfInstance = await pdfLoadingTask.promise;
        pdfDocCacheRef.current[newDocId] = pdfInstance;

        documentToSaveToLibrary = {
          id: newDocId,
          name: file.name,
          type: 'pdf',
          pdfBase64: pdfBase64,
          createdAt: Date.now(),
        };
        saveToRead2LibrarySuccess = LocalStorage.addRead2StoredDocument(documentToSaveToLibrary);

        if (saveToRead2LibrarySuccess) {
          setActiveDocument({ 
            id: newDocId,
            title: file.name,
            type: 'pdf',
            pdfDataUrl: pdfDataUrlFull,
            numPages: pdfInstance.numPages,
            processedPages: new Array(pdfInstance.numPages).fill(null).map(() => ({ imageDataUrl: '', extractedText: undefined })),
          });
          LocalStorage.saveLastActiveMangaRoomDocId(newDocId);
          toast({ title: "PDF Uploaded", description: `${file.name} added to 'Manga Room Uploads' library & active.` });
          setCurrentPdfInternalPageIndex(0);
          setJumpToPageInput('1');
        } else {
            toast({ 
                variant: "destructive", 
                title: "Storage Quota Exceeded", 
                description: `Failed to save ${file.name} to Manga Room library. Browser local storage is likely full. Please delete items from the Library page to free up space. This is a browser limitation, not an application bug.`, 
                duration: 10000 
            });
            console.warn(`MangaRoom: Failed to save ${file.name} to Manga Room library due to storage quota. Document not persisted.`);
            if (activeDocument?.id === 'temp-loading') setActiveDocument(null);
        }
      } else {
        toast({ variant: "destructive", title: "Unsupported File", description: "Please upload an Image or PDF file for Manga Room." });
         if (activeDocument?.id === 'temp-loading') setActiveDocument(null);
      }

    } catch (error: any) {
      console.error("File Upload Error:", error);
      toast({ variant: "destructive", title: "Upload Error", description: error.message || "Failed to process file." });
      if (activeDocument?.id === 'temp-loading') setActiveDocument(null);
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
    if (!doc || doc.type !== 'pdf') return;

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
             setJumpToPageInput(currentPdfInternalPageIndex >=0 && currentPdfInternalPageIndex < doc.numPages ? (currentPdfInternalPageIndex + 1).toString() : '1');
        }
    } else {
      setJumpToPageInput(resetValue);
    }
  };

  const handleClearActiveDocument = () => {
    stopSpeechFnRef.current(true);
    setActiveDocument(null);
    setCurrentPdfInternalPageIndex(0);
    setJumpToPageInput('');
    setSentenceSegments([]);
    setCurrentSentenceIndex(-1);
    LocalStorage.saveLastActiveMangaRoomDocId(null); 
    toast({title: "Document Cleared", description: "The current document has been cleared from view."});
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
      LocalStorage.addFavoriteItem(newFavorite);
      toast({ title: "Favorited!", description: `"${selection.substring(0, 30)}..." added to favorites.` });
    } else if (!selection) {
      toast({ variant: "destructive", title: "No Selection", description: "Please select text to favorite." });
    } else if (!currentDocForFavorite) {
      toast({ variant: "destructive", title: "No Document", description: "Cannot favorite text without an active document." });
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
                    !isLoadingDocument &&
                    !isLoadingInitialDoc &&
                    activeDocument &&
                    activeDocument.id !== 'temp-loading' && 
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

  if (isLoadingInitialDoc) {
    return (
      <div className="flex flex-col flex-grow items-center justify-center p-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">Loading Manga Room...</p>
      </div>
    );
  }


  return (
    <div className="flex flex-col w-full p-4 md:p-6 space-y-6">
       <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Upload to Manga Room</CardTitle>
          <CardDescription>Upload an image or PDF. It will be added to the 'Manga Room Uploads' list in your Library and become active here.</CardDescription>
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
              disabled={isLoadingDocument || isLoadingInitialDoc}
            />
          </div>
          {(isLoadingDocument && activeDocument?.id === 'temp-loading' && !isLoadingInitialDoc) && <p className="mt-2 text-sm text-muted-foreground">Processing uploaded file...</p>}
        </CardContent>
      </Card>

      <div className="flex-grow space-y-6">
          {activeDocument && activeDocument.id !== 'temp-loading' && !isLoadingDocument && !isLoadingInitialDoc && (
            <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="truncate text-xl" title={activeDocument.title || "Untitled Document"}>
                    {activeDocument.title || "Untitled Document"} ({activeDocument.type.toUpperCase()})
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={handleClearActiveDocument} disabled={isLoadingPdfPage || isLoadingTTS || isSpeaking}>
                    <Trash2 className="h-4 w-4 mr-1" /> Clear Active
                </Button>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="relative aspect-[2/3] w-full mx-auto bg-muted rounded-md overflow-hidden shadow-inner">
                  {(isLoadingPdfPage && activeDocument.type==='pdf' && (!currentSubPage?.imageDataUrl)) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10">
                        <Loader2 className="h-12 w-12 animate-spin text-primary" />
                        <p className="mt-2 text-muted-foreground">Loading PDF page image...</p>
                    </div>
                  )}
                  {currentSubPage?.imageDataUrl ? (
                    <Image
                      src={currentSubPage.imageDataUrl}
                      alt={activeDocument.title || `Page content`}
                      fill
                      style={{ objectFit: "contain" }}
                      data-ai-hint="manga page comic"
                      priority={true}
                      key={`${activeDocument.id}-${activeDocument.type==='pdf' ? currentPdfInternalPageIndex : 'image'}-${currentSubPage.imageDataUrl.substring(currentSubPage.imageDataUrl.length - 20)}`}
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
                  ): activeDocument.type === 'image' && !currentSubPage?.imageDataUrl && !isLoadingDocument && !isLoadingInitialDoc ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                        <ImageIcon className="w-16 h-16 text-destructive mb-4" />
                        <p>Image data is missing or failed to load.</p>
                    </div>
                  ) : (
                     !isLoadingDocument && !isLoadingInitialDoc && !activeDocument &&
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                      <ImageIcon className="w-16 h-16 text-primary mb-4" />
                      <p>No content to display. Please select a document from the Library or upload one above.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
             {(textToRead || (isLoadingPdfPage && activeDocument.type === 'pdf' && currentSubPage?.extractedText?.startsWith("Loading")) || (activeDocument.type ==='image' && (activeDocument.extractedText === "Performing OCR..." || activeDocument.extractedText === "Processing uploaded image..."))) && (
                <Card>
                <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-lg">Extracted Text</CardTitle>
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
                            activeDocument.id === 'temp-loading' ||
                            isLoadingDocument ||
                            isLoadingInitialDoc ||
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

          {!activeDocument && !isLoadingDocument && !isLoadingInitialDoc &&(
            <Card className="text-center">
              <CardHeader>
                <CardTitle>No File Loaded</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">Please select or upload a document from your Library, or use the upload above.</p>
                <BookOpen className="mx-auto my-4 h-12 w-12 text-muted-foreground" />
              </CardContent>
            </Card>
          )}

          {isLoadingDocument && activeDocument && activeDocument.id === 'temp-loading' && !isLoadingInitialDoc && (
             <div className="flex flex-col flex-grow items-center justify-center p-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="mt-4 text-muted-foreground">Processing document details...</p>
            </div>
          )}
      </div>

      {activeDocument && activeDocument.id !== 'temp-loading' && !isLoadingDocument && !isLoadingInitialDoc && (
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
                      <Select value={ttsSettings.voiceURI} onValueChange={(v) => handleSettingChange('voiceURI', v)} disabled={(isSpeaking && !isPausedState) || isLoadingTTS || availableVoices.filter(voice => voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0}>
                        <SelectTrigger id="tts-voice" className="h-8 text-xs">
                          <SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No voices available"} />
                        </SelectTrigger>
                        <SelectContent className="max-h-48">
                          {availableVoices.filter(v => v.lang.startsWith(ttsSettings.language.split('-')[0])).map(voice => (
                            <SelectItem key={voice.voiceURI || voice.name} value={voice.voiceURI} className="text-xs">
                              {voice.name} ({voice.lang}) {voice.default ? "[Def]" : ""}
                            </SelectItem>
                          ))}
                           {availableVoices.filter(voice => voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (
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


    