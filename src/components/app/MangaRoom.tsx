
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import type { MangaDocument, MangaImageFile, MangaPdfFile, MangaSubPage, TTSSettings, TTSVoice, FavoriteItem, StoredDocument, StoredImageDocument, StoredPdfDocument } from '@/types';
import { performOCR, getCloudSpeech } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import { Cloud, Loader2, Play, Pause, Smartphone, UploadCloud, BookOpen, ChevronLeft, ChevronRight, Star, Trash2, Image as ImageIcon } from 'lucide-react';
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

  useEffect(() => {
    if (typeof window !== 'undefined') {
      GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
      setTtsSettings(LocalStorage.loadTTSSettings());
    }
  }, []);

  useEffect(() => {
    const loadInitialDocument = async () => {
      setIsLoadingInitialDoc(true);
      let docToLoad: StoredDocument | undefined | null = null;
      const loadFromLibraryId = searchParams.get('loadFromLibraryId');

      if (loadFromLibraryId) {
        docToLoad = LocalStorage.getStoredDocumentById(loadFromLibraryId);
        if (docToLoad) {
          LocalStorage.saveLastActiveMangaRoomDocId(loadFromLibraryId);
        } else {
          toast({ variant: "destructive", title: "Not Found", description: `Document with ID ${loadFromLibraryId} not found in library.` });
          LocalStorage.saveLastActiveMangaRoomDocId(null);
        }
      } else {
        const lastActiveId = LocalStorage.loadLastActiveMangaRoomDocId();
        if (lastActiveId) {
          docToLoad = LocalStorage.getStoredDocumentById(lastActiveId);
          if (!docToLoad) {
            LocalStorage.saveLastActiveMangaRoomDocId(null);
          }
        }
      }

      if (docToLoad) {
        if (docToLoad.type === 'image') {
          const storedImageDoc = docToLoad as StoredImageDocument;
          setIsLoadingDocument(true);
          try {
            const ocrResult = await performOCR(storedImageDoc.imageDataUrl);
            const newMangaImageFile: MangaImageFile = {
              id: storedImageDoc.id,
              title: storedImageDoc.name,
              type: 'image',
              imageDataUrl: storedImageDoc.imageDataUrl,
              extractedText: 'extractedText' in ocrResult ? ocrResult.extractedText : "OCR failed on load.",
            };
            setActiveDocument(newMangaImageFile);
            if ('error' in ocrResult) toast({ variant: "destructive", title: "OCR Error", description: ocrResult.error });
          } catch (e: any) {
            toast({ variant: "destructive", title: "Error loading image", description: e.message });
            setActiveDocument(null);
            LocalStorage.saveLastActiveMangaRoomDocId(null);
          } finally {
            setIsLoadingDocument(false);
          }
        } else if (docToLoad.type === 'pdf') {
          const storedPdfDoc = docToLoad as StoredPdfDocument;
          try {
            if (!pdfDocCacheRef.current[storedPdfDoc.id]) {
                 const pdfBytes = base64ToUint8Array(storedPdfDoc.pdfBase64);
                 const loadingTask = getDocument({data: pdfBytes});
                 pdfDocCacheRef.current[storedPdfDoc.id] = await loadingTask.promise;
            }
            const pdfInstance = pdfDocCacheRef.current[storedPdfDoc.id];

            const newMangaPdfFile: MangaPdfFile = {
              id: storedPdfDoc.id,
              title: storedPdfDoc.name,
              type: 'pdf',
              pdfDataUrl: `data:application/pdf;base64,${storedPdfDoc.pdfBase64}`,
              numPages: pdfInstance.numPages,
              processedPages: new Array(pdfInstance.numPages).fill(null).map(() => ({ imageDataUrl: '', extractedText: undefined })),
            };
            setActiveDocument(newMangaPdfFile);
            const savedPageIndex = LocalStorage.loadCurrentPdfPageIndexForDoc(storedPdfDoc.id);
            setCurrentPdfInternalPageIndex(savedPageIndex !== undefined ? savedPageIndex : 0);
          } catch (e: any) {
             toast({ variant: "destructive", title: "Error loading PDF", description: e.message });
             setActiveDocument(null);
             LocalStorage.saveLastActiveMangaRoomDocId(null);
          }
        }
      }
      setIsLoadingInitialDoc(false);
    };

    loadInitialDocument();
  }, [searchParams, toast]);


  useEffect(() => {
    LocalStorage.saveTTSSettings(ttsSettings);
  }, [ttsSettings]);
  
  useEffect(() => {
    if (activeDocument?.type === 'pdf' && activeDocument.id) {
      LocalStorage.saveCurrentPdfPageIndexForDoc(activeDocument.id, currentPdfInternalPageIndex);
    }
  }, [currentPdfInternalPageIndex, activeDocument]);


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
      stopSpeech(true);
    };
  }, [populateVoiceList, stopSpeech]);

  const renderAndProcessPdfPage = useCallback(async (doc: MangaPdfFile, pageNumToRender: number) => {
    if (!doc || doc.type !== 'pdf' || pageNumToRender < 0 || pageNumToRender >= doc.numPages) {
      setIsLoadingPdfPage(false);
      return;
    }
    setIsLoadingPdfPage(true);
    setSentenceSegments([]);
    setCurrentSentenceIndex(-1);

    const currentSubPageData = doc.processedPages[pageNumToRender];
    if (currentSubPageData?.imageDataUrl && currentSubPageData?.extractedText !== undefined && !currentSubPageData?.extractedText?.startsWith("Error:")) {
       setIsLoadingPdfPage(false);
       return; 
    }

    try {
      let pdfDocInstance = pdfDocCacheRef.current[doc.id];
      if (!pdfDocInstance) {
        if (!doc.pdfDataUrl || !doc.pdfDataUrl.startsWith('data:application/pdf;base64,')) {
            const errorMsg = `Corrupted or missing PDF data for ${doc.title}. Please re-upload.`;
            toast({ variant: "destructive", title: "PDF Data Error", description: errorMsg });
             setActiveDocument(prevDoc => {
              if (prevDoc && prevDoc.id === doc.id && prevDoc.type === 'pdf') {
                const updatedProcessedPages = [...prevDoc.processedPages];
                updatedProcessedPages[pageNumToRender] = { imageDataUrl: '', extractedText: `Error: ${errorMsg}`};
                return { ...prevDoc, processedPages: updatedProcessedPages };
              }
              return prevDoc;
            });
            setIsLoadingPdfPage(false);
            return;
        }
        const base64Data = doc.pdfDataUrl.split(',')[1];
        if (!base64Data) {
            const errorMsg = `Empty PDF data for ${doc.title}. Try re-uploading.`;
            toast({ variant: "destructive", title: "PDF Data Error", description: errorMsg });
            setActiveDocument(prevDoc => {
              if (prevDoc && prevDoc.id === doc.id && prevDoc.type === 'pdf') {
                const updatedProcessedPages = [...prevDoc.processedPages];
                updatedProcessedPages[pageNumToRender] = { imageDataUrl: '', extractedText: `Error: ${errorMsg}`};
                return { ...prevDoc, processedPages: updatedProcessedPages };
              }
              return prevDoc;
            });
            setIsLoadingPdfPage(false);
            return;
        }
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

      if (context) {
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        const imageDataUrl = canvas.toDataURL('image/png');

        const ocrResult = await performOCR(imageDataUrl);
        const newSubPage: MangaSubPage = {
          imageDataUrl,
          extractedText: 'extractedText' in ocrResult ? ocrResult.extractedText : "OCR failed for this page.",
        };

        setActiveDocument(prevDoc => {
          if (prevDoc && prevDoc.id === doc.id && prevDoc.type === 'pdf') {
            const updatedProcessedPages = [...prevDoc.processedPages];
            updatedProcessedPages[pageNumToRender] = newSubPage;
            return { ...prevDoc, processedPages: updatedProcessedPages };
          }
          return prevDoc;
        });

        if ('error' in ocrResult) {
          toast({ variant: "destructive", title: "OCR Error on PDF Page", description: ocrResult.error });
        }
      } else {
        throw new Error("Canvas context not available for PDF page rendering.");
      }
    } catch (error: any) {
      console.error("Error processing PDF page:", error);
      const errorMsg = error.message || `Failed to process page ${pageNumToRender + 1}.`;
      toast({ variant: "destructive", title: "PDF Page Error", description: errorMsg });
       setActiveDocument(prevDoc => {
          if (prevDoc && prevDoc.id === doc.id && prevDoc.type === 'pdf') {
            const updatedProcessedPages = [...prevDoc.processedPages];
            updatedProcessedPages[pageNumToRender] = { imageDataUrl: '', extractedText: `Error processing page: ${errorMsg}`};
            return { ...prevDoc, processedPages: updatedProcessedPages };
          }
          return prevDoc;
        });
    } finally {
      setIsLoadingPdfPage(false);
    }
  }, [toast]);

  useEffect(() => {
    if (activeDocument?.type === 'pdf' && activeDocument.numPages > 0 && currentPdfInternalPageIndex < activeDocument.numPages) {
      setJumpToPageInput((currentPdfInternalPageIndex + 1).toString());
      const currentPageData = activeDocument.processedPages[currentPdfInternalPageIndex];
      if ((!currentPageData || !currentPageData.imageDataUrl || currentPageData.extractedText === undefined || currentPageData.extractedText.startsWith("Error:")) &&
          !isLoadingPdfPage
         ) {
         renderAndProcessPdfPage(activeDocument as MangaPdfFile, currentPdfInternalPageIndex);
      }
    } else if (activeDocument?.type === 'image') {
      setJumpToPageInput('');
    } else if (!activeDocument) {
      setJumpToPageInput('');
    }
  }, [activeDocument, currentPdfInternalPageIndex, renderAndProcessPdfPage, isLoadingPdfPage]);


  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    stopSpeech(true);
    setIsLoadingDocument(true);
    setCurrentPdfInternalPageIndex(0);
    setJumpToPageInput('');
    setActiveDocument(null); // Clear previous active document

    const newDocId = Date.now().toString();
    const fileInputTarget = event.target;

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const imageDataUrl = e.target?.result as string;
        if (!imageDataUrl || !imageDataUrl.startsWith('data:image')) {
            toast({ variant: "destructive", title: "Upload Error", description: "Invalid or corrupted image file." });
            setIsLoadingDocument(false);
            if (fileInputTarget) fileInputTarget.value = '';
            return;
        }
        try {
            const ocrResult = await performOCR(imageDataUrl);
            const newMangaImageFile: MangaImageFile = {
              id: newDocId,
              title: file.name,
              type: 'image',
              imageDataUrl,
              extractedText: 'extractedText' in ocrResult ? ocrResult.extractedText : "OCR failed.",
            };
            setActiveDocument(newMangaImageFile);
            
            const newImageDocForLibrary: StoredImageDocument = {
              id: newDocId,
              name: file.name,
              type: 'image',
              imageDataUrl: imageDataUrl,
              createdAt: Date.now(),
            };
            LocalStorage.addStoredDocument(newImageDocForLibrary);
            LocalStorage.saveLastActiveMangaRoomDocId(newDocId);
            toast({ title: "Image Uploaded", description: `${file.name} processed and added to library.` });

            if ('error' in ocrResult) {
              toast({ variant: "destructive", title: "OCR Error", description: ocrResult.error });
            }
        } catch (ocrError: any) {
            toast({ variant: "destructive", title: "OCR Processing Error", description: ocrError.message || "Failed to process text extraction." });
        } finally {
            setIsLoadingDocument(false);
            if (fileInputTarget) fileInputTarget.value = '';
        }
      };
      reader.onerror = () => {
        toast({ variant: "destructive", title: "File Read Error", description: "Could not read the image file." });
        setIsLoadingDocument(false);
        if (fileInputTarget) fileInputTarget.value = '';
      };
      reader.readAsDataURL(file);

    } else if (file.type === 'application/pdf') {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const pdfDataUrl = e.target?.result as string;
         if (!pdfDataUrl || !pdfDataUrl.startsWith('data:application/pdf;base64,')) {
            toast({ variant: "destructive", title: "Upload Error", description: "Invalid or corrupted PDF file processed." });
            setIsLoadingDocument(false);
            if (fileInputTarget) fileInputTarget.value = '';
            return;
        }

        try {
          const pdfBase64 = pdfDataUrl.split(',')[1];
          if (!pdfBase64) {
              const errorMsg = `Could not extract data from PDF ${file.name}.`;
              toast({ variant: "destructive", title: "PDF Upload Error", description: errorMsg });
              setIsLoadingDocument(false);
              if (fileInputTarget) fileInputTarget.value = '';
              return;
          }
          const pdfBytes = base64ToUint8Array(pdfBase64);
          const loadingTask = getDocument({data: pdfBytes});
          const pdfProxy = await loadingTask.promise;
          pdfDocCacheRef.current[newDocId] = pdfProxy;

          const newMangaPdfFile: MangaPdfFile = {
            id: newDocId,
            title: file.name,
            type: 'pdf',
            pdfDataUrl: pdfDataUrl, 
            numPages: pdfProxy.numPages,
            processedPages: new Array(pdfProxy.numPages).fill(null).map(() => ({imageDataUrl: '', extractedText: undefined})),
          };
          setActiveDocument(newMangaPdfFile);
          setCurrentPdfInternalPageIndex(0);
          setJumpToPageInput('1');

          const newPdfDocForLibrary: StoredPdfDocument = {
            id: newDocId,
            name: file.name,
            type: 'pdf',
            pdfBase64: pdfBase64,
            createdAt: Date.now(),
          };
          LocalStorage.addStoredDocument(newPdfDocForLibrary);
          LocalStorage.saveLastActiveMangaRoomDocId(newDocId);
          toast({ title: "PDF Uploaded", description: `${file.name} processed and added to library.` });

        } catch (pdfLoadError: any) {
          console.error("Error loading PDF:", pdfLoadError);
          let errorDescription = "Failed to load PDF. The file might be corrupted or not a standard PDF.";
          if (pdfLoadError instanceof Error) {
            errorDescription = pdfLoadError.message;
          } else if (typeof pdfLoadError === 'string') {
            errorDescription = pdfLoadError;
          }
          toast({ variant: "destructive", title: "PDF Load Error", description: errorDescription });
        } finally {
          setIsLoadingDocument(false);
          if (fileInputTarget) fileInputTarget.value = '';
        }
      };
      reader.onerror = () => {
        toast({ variant: "destructive", title: "File Read Error", description: "Could not process the PDF file content." });
        setIsLoadingDocument(false);
        if (fileInputTarget) fileInputTarget.value = '';
      };
      reader.readAsDataURL(file);

    } else {
      toast({ variant: "destructive", title: "Unsupported File Type", description: "Please upload an image or a PDF file." });
      setIsLoadingDocument(false);
      if (fileInputTarget) fileInputTarget.value = '';
    }
  };

  let currentSubPage: MangaSubPage | null | undefined = null;
  let textToRead = "";

  if (activeDocument) {
    if (activeDocument.type === 'image') {
      currentSubPage = {imageDataUrl: activeDocument.imageDataUrl, extractedText: activeDocument.extractedText};
      textToRead = activeDocument.extractedText || "";
    } else if (activeDocument.type === 'pdf' && activeDocument.processedPages) {
      currentSubPage = activeDocument.processedPages[currentPdfInternalPageIndex];
      textToRead = currentSubPage?.extractedText || "";
       if (!currentSubPage?.imageDataUrl && !isLoadingPdfPage && activeDocument.numPages > 0) {
         textToRead = "Processing PDF page, please wait...";
      } else if (currentSubPage?.extractedText?.startsWith("Error:")) {
         textToRead = currentSubPage.extractedText;
      } else if (currentSubPage && currentSubPage.extractedText === undefined && !isLoadingPdfPage) {
         textToRead = "Page processed. No text extracted or OCR failed for this page. Select text manually if available on image.";
      } else if (isLoadingPdfPage) {
         textToRead = "Loading PDF page content...";
      }
    }
  }

  const playSpeech = async () => {
    setIsLoadingTTS(true);

    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const effectiveTextToRead = selectedText || textToRead;

    if (!effectiveTextToRead || isLoadingPdfPage || !activeDocument || textToRead.startsWith("Error:")) {
      toast({ variant: "destructive", title: "No Text", description: "No valid text available to read or PDF page is loading." });
      setIsLoadingTTS(false);
      setIsSpeaking(false);
      return;
    }

    stopSpeech(false); 
    await new Promise(resolve => setTimeout(resolve, 150));

    setIsSpeaking(true);
    setIsPausedState(false);

    if (ttsSettings.type === 'local') {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
        setIsLoadingTTS(false);
        setIsSpeaking(false);
        return;
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
        if (utteranceRef.current === utterance) stopSpeech(true);
      };
      utterance.onerror = (event) => {
         if (utteranceRef.current === utterance) { 
            toast({ variant: "destructive", title: "TTS Error", description: event.error || "Failed to play speech." });
            stopSpeech(true);
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
          stopSpeech(true);
        } else {
            throw new Error("Invalid response from cloud TTS");
        }
      } catch (error: any) {
        toast({ variant: "destructive", title: "Cloud TTS Request Failed", description: error.message || "Unknown error." });
        stopSpeech(true);
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
                        stopSpeech(true);
                    }
                }, 100);
            } else {
                stopSpeech(true); 
            }
        }
        else if (ttsSettings.type === 'cloud' && audioPlayerRef.current && audioPlayerRef.current.paused) {
            audioPlayerRef.current.play().catch(e => {
                toast({variant: "destructive", title: "Resume Error", description: "Could not resume audio."});
                stopSpeech(true); 
            });
            setIsPausedState(false);
        }
    }
  };


  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;

    const handleAudioEnded = () => stopSpeech(true);
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
      stopSpeech(true);
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
  }, [ttsSettings.type, isSpeaking, toast, stopSpeech]);


  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    stopSpeech(true);
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
      LocalStorage.saveTTSSettings(newSettings); // Save immediately
      return newSettings;
    });

    if (key === 'type') {
      setSentenceSegments([]);
      setCurrentSentenceIndex(-1);
    }
  };

  const navigatePdfPage = (direction: 'next' | 'prev') => {
    stopSpeech(true);
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
    if (doc && doc.type === 'pdf' && doc.numPages > 0) {
      resetValue = (currentPdfInternalPageIndex + 1).toString();
    }
    
    const pageNumFromInputText = parseInt(jumpToPageInput, 10);
    if (doc && doc.type === 'pdf' && doc.numPages > 0) {
        if (isNaN(pageNumFromInputText) || pageNumFromInputText < 1 || pageNumFromInputText > doc.numPages) {
             setJumpToPageInput((currentPdfInternalPageIndex + 1).toString());
        } else {
             if (jumpToPageInput !== (currentPdfInternalPageIndex+1).toString()) {
                 setJumpToPageInput((currentPdfInternalPageIndex+1).toString());
             }
        }
    } else {
      setJumpToPageInput(resetValue);
    }
  };

  const handleClearActiveDocument = () => {
    stopSpeech(true);
    if (activeDocument) {
        delete pdfDocCacheRef.current[activeDocument.id];
        LocalStorage.saveLastActiveMangaRoomDocId(null);
    }
    setActiveDocument(null);
    setCurrentPdfInternalPageIndex(0);
    setJumpToPageInput('');
    setSentenceSegments([]);
    setCurrentSentenceIndex(-1);
    toast({title: "Document Cleared", description: "The current document has been cleared from view."});
  }


  const handleFavoriteSelection = () => {
    const selection = window.getSelection()?.toString().trim();
    const currentDocForFavorite = activeDocument;
    if (selection && currentDocForFavorite) {
      const newFavorite: FavoriteItem = {
        id: Date.now().toString(),
        text: selection,
        sourceDocumentId: currentDocForFavorite.id,
        sourceDocumentName: currentDocForFavorite.title || "Untitled Manga Document",
        createdAt: Date.now(),
      };
      LocalStorage.addFavoriteItem(newFavorite);
      toast({ title: "Favorited!", description: `"${selection.substring(0, 30)}..." added to favorites.` });
    } else if (!selection) {
      toast({ variant: "destructive", title: "No Selection", description: "Please select text to favorite." });
    }
  };


  const getPlayButtonState = () => {
    const canPlay = !!((typeof window !== 'undefined' && window.getSelection()?.toString().trim()) || textToRead) && !isLoadingPdfPage && !isLoadingDocument && activeDocument && !textToRead.startsWith("Error:");

    if (isLoadingTTS) return { icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, text: "Loading...", action: () => {}, disabled: true, variant: "default" as const };

    if (isSpeaking) {
        if (isPausedState) {
            return { icon: <Play className="mr-1 h-4 w-4" />, text: "Resume", action: resumeSpeech, variant: "outline" as const};
        }
        return { icon: <Pause className="mr-1 h-4 w-4" />, text: "Pause", action: pauseSpeech, variant: "outline" as const};
    }
    return {
        icon: <Play className="mr-1 h-4 w-4" />,
        text: (typeof window !== 'undefined' && window.getSelection()?.toString().trim()) ? "Play Selected" : "Play All",
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
        <p className="mt-4 text-muted-foreground">Loading document viewer...</p>
      </div>
    );
  }


  return (
    <div className="flex flex-col w-full p-4 md:p-6 space-y-6">
      {/* Content Area (Upload, Image/PDF display, Extracted Text) */}
      <div className="flex-grow space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Upload Document</CardTitle>
              <CardDescription>Upload an image or a PDF document. This will replace any current file and add it to your library.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid w-full max-w-sm items-center gap-1.5">
                <Label htmlFor="manga-upload">Document File</Label>
                <Input id="manga-upload" type="file" accept="image/*,application/pdf" onChange={handleFileUpload} disabled={isLoadingDocument || isLoadingPdfPage} />
              </div>
              {(isLoadingDocument) && <Progress value={undefined} className="w-full mt-2 h-2" />}
            </CardContent>
          </Card>

          {activeDocument && (
            <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="truncate text-xl" title={activeDocument.title || "Untitled Document"}>
                    {activeDocument.title || "Untitled Document"}
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={handleClearActiveDocument} disabled={isLoadingDocument || isLoadingPdfPage || isLoadingTTS || isSpeaking}>
                    <Trash2 className="h-4 w-4 mr-1" /> Clear Active
                </Button>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="relative aspect-[2/3] w-full mx-auto bg-muted rounded-md overflow-hidden shadow-inner">
                  {(isLoadingPdfPage && !currentSubPage?.imageDataUrl && activeDocument.type==='pdf') && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10">
                        <Loader2 className="h-12 w-12 animate-spin text-primary" />
                        <p className="mt-2 text-muted-foreground">Loading PDF page...</p>
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
                      key={`${activeDocument.id}-${currentPdfInternalPageIndex}-${currentSubPage.imageDataUrl.substring(0,20)}`}
                    />
                  ) : activeDocument.type === 'pdf' && !isLoadingPdfPage ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                      <BookOpen className="w-16 h-16 text-primary mb-4" />
                      <p className="font-semibold">{activeDocument.title || 'PDF Document'}</p>
                      <p className="text-sm text-muted-foreground">
                        { activeDocument.numPages > 0 ? `Page ${currentPdfInternalPageIndex + 1} of ${activeDocument.numPages}. Waiting to process...` : "Empty PDF or error loading."}
                      </p>
                       {isLoadingPdfPage && <Loader2 className="h-6 w-6 animate-spin text-primary mt-2" />}
                       {!isLoadingPdfPage && activeDocument.numPages > 0 && (!currentSubPage?.imageDataUrl || currentSubPage?.extractedText?.startsWith("Error:")) &&
                         <Button onClick={() => renderAndProcessPdfPage(activeDocument as MangaPdfFile, currentPdfInternalPageIndex)} className="mt-2" size="sm" disabled={isLoadingPdfPage}>Process This Page</Button>
                       }
                      <p className="text-xs text-muted-foreground mt-2">If this takes too long, the page might be complex or an error occurred.</p>
                    </div>
                  ) : (
                     !isLoadingDocument && !isLoadingInitialDoc &&
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                      <ImageIcon className="w-16 h-16 text-primary mb-4" />
                      <p>No content to display. Please upload a file.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
             {(textToRead || (isLoadingPdfPage && !currentSubPage?.extractedText && activeDocument.type === 'pdf')) && (
                <Card>
                <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-lg">Extracted Text</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                    <div 
                        className={cn(
                            "min-h-[100px] max-h-60 overflow-y-auto p-2 border rounded-md bg-muted/30 whitespace-pre-wrap text-sm select-text",
                            textToRead.startsWith("Error:") && "text-destructive bg-destructive/10"
                        )}
                    >
                    {isLoadingPdfPage && !currentSubPage?.extractedText ? "Loading page text..." :
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
                    <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="mt-3">
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
                <p className="text-muted-foreground">Upload a manga image or a PDF document to get started.</p>
                <UploadCloud className="mx-auto my-4 h-12 w-12 text-muted-foreground" />
              </CardContent>
            </Card>
          )}
      </div>

      {/* Controls Area (PDF Nav, TTS Settings) - stacked below content */}
      {activeDocument && (
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
                              stopSpeech(true); 
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

              {(textToRead || (typeof window !== 'undefined' && window.getSelection()?.toString().trim())) && !isLoadingPdfPage && (
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

