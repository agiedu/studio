
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation'; // useRouter might be used for navigation later
import type { MangaDocument, MangaImageFile, MangaPdfFile, MangaSubPage, TTSSettings, TTSVoice, FavoriteItem } from '@/types';
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

export function MangaRoom() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeDocument, setActiveDocument] = useState<MangaDocument | null>(null);
  const [currentPdfInternalPageIndex, setCurrentPdfInternalPageIndex] = useState(0);
  const [jumpToPageInput, setJumpToPageInput] = useState('');

  const [ttsSettings, setTtsSettings] = useState<TTSSettings>(LocalStorage.defaultTTSSettings);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false);
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
  const currentFileLocalPathRef = useRef<string | null>(null);

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

  useEffect(() => {
    LocalStorage.saveTTSSettings(ttsSettings);
  }, [ttsSettings]);

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
      const currentSettings = LocalStorage.loadTTSSettings(); // Load fresh settings
      if (!currentSettings.voiceURI && voices.length > 0) {
        const defaultVoice = voices.find(v => v.lang === currentSettings.language && v.default) || voices.find(v => v.lang === currentSettings.language) || voices.find(v => v.default) || voices[0];
        if (defaultVoice) {
          const newSettings = { ...currentSettings, voiceURI: defaultVoice.voiceURI, language: defaultVoice.lang };
          setTtsSettings(newSettings); // This will also trigger saveTTSSettings effect
        }
      } else {
         setTtsSettings(currentSettings); // Ensure settings are synced if no default voice change
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
        if (!doc.pdfDataUrl) {
            const errorMsg = `PDF data not available in current session for ${doc.title}. Cannot render page.`;
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
        const pdfBase64 = doc.pdfDataUrl.split(',')[1];
        const pdfBytes = base64ToUint8Array(pdfBase64);
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
      }
      setActiveDocument(prevD => {
        if (prevD && prevD.id === doc.id && prevD.type === 'pdf') {
          const updatedPages = [...prevD.processedPages];
          updatedPages[pageNumToRender] = { imageDataUrl, extractedText: textForPage };
          return { ...prevD, processedPages: updatedPages };
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
            return { ...prevD, processedPages: updatedPages };
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
    // Initial temporary active document state
    const tempDocId = `temp-processing-doc-${Date.now()}`;
    setActiveDocument({
        id: tempDocId,
        title: file.name,
        type: file.type.startsWith('image/') ? 'image' : 'pdf',
        ...(file.type.startsWith('image/') ? { imageDataUrl: '', extractedText: "Processing uploaded image..." } : { pdfDataUrl: '', numPages: 0, processedPages: [] })
    } as MangaDocument);
    currentFileLocalPathRef.current = null;


    const formDataForLocalService = new FormData();
    formDataForLocalService.append('file', file);
    let localFilePath: string | undefined;

    try {
        const localUploadResult = await uploadFileToLocalServer(formDataForLocalService);
        if (localUploadResult.success && localUploadResult.filePath) {
            toast({ title: "File Sent to Local Device", description: `${file.name} sent. Path: ${localUploadResult.filePath}` });
            localFilePath = localUploadResult.filePath;
            currentFileLocalPathRef.current = localFilePath;
        } else {
            toast({ variant: "destructive", title: "Local Save Failed", description: (localUploadResult.message || "Could not save to local device.") + " File will only be available for this session." });
            currentFileLocalPathRef.current = file.name; // Fallback for favorites
        }
    } catch (uploadError: any) {
        toast({ variant: "destructive", title: "Local Save Service Error", description: (uploadError.message || "Could not send file to local service.") + " File will only be available for this session." });
        currentFileLocalPathRef.current = file.name; // Fallback
    }

    const sessionDocId = `session-${file.type.startsWith('image/') ? 'image' : 'pdf'}-${Date.now()}`;

    try {
      if (file.type.startsWith('image/')) {
        const imageDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        setActiveDocument({
            id: sessionDocId,
            title: file.name,
            type: 'image',
            imageDataUrl: imageDataUrl,
            extractedText: "Performing OCR...",
        });

        let ocrText = "OCR pending...";
        try {
            const ocrResult = await performOCR(imageDataUrl);
            ocrText = 'extractedText' in ocrResult ? ocrResult.extractedText : (ocrResult.error || "OCR processing failed.");
            if ('error' in ocrResult && ocrResult.error) {
                toast({ variant: "destructive", title: "OCR Error during upload", description: ocrText });
            }
        } catch (ocrError: any) {
           ocrText = `OCR failed: ${ocrError.message || "Unknown OCR error."}`;
           toast({ variant: "destructive", title: "OCR Processing Error", description: ocrText });
        }
        
         setActiveDocument(prev => (prev?.id === sessionDocId ? {
            ...(prev as MangaImageFile),
            extractedText: ocrText,
        }: prev));
        
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
        
        const initialPageIndex = 0;
        
        setActiveDocument({
            id: sessionDocId,
            title: file.name,
            type: 'pdf',
            pdfDataUrl: pdfDataUrlFull,
            numPages: pdfInstance.numPages,
            processedPages: new Array(pdfInstance.numPages).fill(null).map(() => ({ imageDataUrl: '', extractedText: undefined })),
        });
        setCurrentPdfInternalPageIndex(initialPageIndex);
        setJumpToPageInput((initialPageIndex + 1).toString());
        pdfDocCacheRef.current = {}; // Clear cache for new PDF
        pdfDocCacheRef.current[sessionDocId] = pdfInstance; // Cache the new PDF instance
      } else {
        toast({ variant: "destructive", title: "Unsupported File", description: "Please upload an Image or PDF file for Manga Room." });
        setActiveDocument(null); // Clear the temporary processing doc
        currentFileLocalPathRef.current = null;
      }
    } catch (error: any) {
      console.error("File Session Processing Error:", error);
      toast({ variant: "destructive", title: "Session Processing Error", description: error.message || "Failed to process file for this session." });
      setActiveDocument(null); // Clear the temporary processing doc
      currentFileLocalPathRef.current = null;
    } finally {
      setIsLoadingDocument(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = ''; // Reset file input
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
    await new Promise(resolve => setTimeout(resolve, 150)); // Short delay for UI to settle

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

    } else { // Cloud TTS
      setSentenceSegments([]); // Cloud TTS doesn't support sentence highlighting directly
      setCurrentSentenceIndex(-1);
      try {
        const cloudResult = await getCloudSpeech(effectiveTextToRead, ttsSettings.language);
        if ('audioUrl' in cloudResult && audioPlayerRef.current) {
            audioPlayerRef.current.src = cloudResult.audioUrl;
            await audioPlayerRef.current.play();
            // setIsLoadingTTS(false) is handled by 'playing' event of audio player
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
                // Check if speech actually resumed (workaround for some browser issues)
                setTimeout(() => {
                    if (utteranceRef.current && isSpeaking && !isPausedState && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
                        stopSpeechFnRef.current(true); // Speech didn't resume, stop everything
                    }
                }, 100);
            } else { // Not paused, so something went wrong
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
            setIsLoadingTTS(false); // Cloud TTS is loaded and playing
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
      player.src = ""; // Release the audio source
      if (audioPlayerRef.current === player) audioPlayerRef.current = null;
    };
  }, [ttsSettings.type, isSpeaking, toast]);


  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    stopSpeechFnRef.current(true);
    setTtsSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      // If language changes for local TTS, try to find a suitable voice
      if (key === 'language' && newSettings.type === 'local') {
        const suitableVoice = availableVoices.find(v => v.lang === value && v.default) || availableVoices.find(v => v.lang === value);
        if (suitableVoice) {
            newSettings.voiceURI = suitableVoice.voiceURI;
        } else {
            newSettings.voiceURI = undefined; // No suitable voice found for the new language
        }
      }
      return newSettings;
    });

    // If TTS type changed, clear sentence highlighting as it's specific to local TTS
    if (key === 'type') {
      setSentenceSegments([]);
      setCurrentSentenceIndex(-1);
    }
  };

  const navigatePdfPage = (direction: 'next' | 'prev') => {
    stopSpeechFnRef.current(true); // Stop any speech before navigating
    const doc = activeDocument;
    if (!doc || doc.type !== 'pdf' ) return;

    let newPdfPage = currentPdfInternalPageIndex;
    if (direction === 'next') {
      if (currentPdfInternalPageIndex < doc.numPages - 1) {
        newPdfPage = currentPdfInternalPageIndex + 1;
      }
    } else { // prev
      if (currentPdfInternalPageIndex > 0) {
        newPdfPage = currentPdfInternalPageIndex - 1;
      }
    }
    if (newPdfPage !== currentPdfInternalPageIndex) {
      setCurrentPdfInternalPageIndex(newPdfPage);
      // renderAndProcessPdfPage will be called by the useEffect watching currentPdfInternalPageIndex
    }
  };

  const handleJumpToPageOnBlur = () => {
    const doc = activeDocument;
    let resetValue = '';
    // Determine the value to reset to if input is invalid
    if (doc && doc.type === 'pdf' && doc.numPages > 0 && currentPdfInternalPageIndex >= 0 && currentPdfInternalPageIndex < doc.numPages) {
      resetValue = (currentPdfInternalPageIndex + 1).toString();
    }

    const pageNumFromInputText = parseInt(jumpToPageInput, 10);
    if (doc && doc.type === 'pdf' && doc.numPages > 0) {
        if (isNaN(pageNumFromInputText) || pageNumFromInputText < 1 || pageNumFromInputText > doc.numPages) {
             // If invalid, revert to current page number (if valid) or '1'
             setJumpToPageInput(currentPdfInternalPageIndex >=0 && currentPdfInternalPageIndex < doc.numPages ? (currentPdfInternalPageIndex + 1).toString() : '1');
        }
        // If valid, currentPdfInternalPageIndex is already set by onChange, no need to set here again.
    } else {
      // No active PDF or no pages, just clear the input or reset to a sensible default if needed
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
    currentFileLocalPathRef.current = null;
    pdfDocCacheRef.current = {}; // Clear PDF cache
    toast({title: "Session Document Cleared", description: "The current document has been cleared from this session."});
     if (fileInputRef.current) {
        fileInputRef.current.value = ''; // Reset file input
    }
  }


  const handleFavoriteSelection = () => {
    const selection = window.getSelection()?.toString().trim();
    const currentDocForFavorite = activeDocument; // Use the state variable
    if (selection && currentDocForFavorite) {
      const newFavorite: FavoriteItem = {
        id: Date.now().toString(),
        text: selection,
        sourceDocumentId: currentFileLocalPathRef.current || currentDocForFavorite.title || "unknown_source",
        sourceDocumentName: currentDocForFavorite.title || "Untitled Document",
        createdAt: Date.now(),
      };
      LocalStorage.addFavoriteItem(newFavorite);
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
                    !isLoadingDocument &&
                    activeDocument && // Ensure there's an active document
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
    // Default play button
    return {
        icon: <Play className="mr-1 h-4 w-4" />,
        text: selectedTextContent ? "Play Selected" : "Play All",
        action: playSpeech,
        disabled: !canPlay,
        variant: "default" as const
    };
  };

  const playButtonState = getPlayButtonState();

  return (
    <div className="flex flex-col w-full p-4 md:p-6 space-y-6">
       <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Upload Document for This Session</CardTitle>
          <CardDescription>
            Upload an image or PDF to process and read in the current session.
            The file will also be sent to your local helper service for persistent storage on your device (if the service is running).
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
              disabled={isLoadingDocument}
            />
          </div>
          {isLoadingDocument && <p className="mt-2 text-sm text-muted-foreground">Processing uploaded file: {activeDocument?.title || "New file"}...</p>}
        </CardContent>
      </Card>

      <div className="flex-grow space-y-6">
          {/* Display Area for Active Document */}
          {activeDocument && !isLoadingDocument && (
            <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="truncate text-xl" title={activeDocument.title || "Untitled Document"}>
                    Session: {activeDocument.title || "Untitled Document"} ({activeDocument.type.toUpperCase()})
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={handleClearActiveDocument} disabled={isLoadingPdfPage || isLoadingTTS || isSpeaking}>
                    <Trash2 className="h-4 w-4 mr-1" /> Clear Session Doc
                </Button>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="relative aspect-[2/3] w-full mx-auto bg-muted rounded-md overflow-hidden shadow-inner">
                  {/* Loading state specifically for PDF page image */}
                  {(isLoadingPdfPage && activeDocument.type==='pdf' && (!currentSubPage?.imageDataUrl)) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10">
                        <Loader2 className="h-12 w-12 animate-spin text-primary" />
                        <p className="mt-2 text-muted-foreground">Loading PDF page image...</p>
                    </div>
                  )}
                  {/* Image display */}
                  {currentSubPage?.imageDataUrl ? (
                    <Image
                      src={currentSubPage.imageDataUrl}
                      alt={activeDocument.title || `Page content`}
                      fill
                      style={{ objectFit: "contain" }}
                      data-ai-hint="manga page comic"
                      priority={true}
                      // Ensure key changes when image source or page index changes to force re-render if necessary
                      key={`${activeDocument.id}-${activeDocument.type==='pdf' ? currentPdfInternalPageIndex : 'image'}-${currentSubPage.imageDataUrl.substring(currentSubPage.imageDataUrl.length - 20)}`}
                    />
                  ) : activeDocument.type === 'pdf' && !isLoadingPdfPage && activeDocument.numPages > 0 ? (
                    // Placeholder for PDF when image isn't loaded yet but document exists
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                      <BookOpen className="w-16 h-16 text-primary mb-4" />
                      <p className="font-semibold">{activeDocument.title || 'PDF Document'}</p>
                      <p className="text-sm text-muted-foreground">
                        { activeDocument.numPages > 0 ? `Page ${currentPdfInternalPageIndex + 1} of ${activeDocument.numPages}. Waiting to process...` : "Empty PDF or error loading."}
                      </p>
                       {isLoadingPdfPage && <Loader2 className="h-6 w-6 animate-spin text-primary mt-2" />}
                       {/* Button to manually trigger processing if auto-processing failed or didn't run */}
                       {!isLoadingPdfPage && activeDocument.numPages > 0 && (!currentSubPage?.imageDataUrl || currentSubPage?.extractedText?.startsWith("Error:") || currentSubPage?.extractedText === undefined) &&
                         <Button onClick={() => renderAndProcessPdfPage(activeDocument as MangaPdfFile, currentPdfInternalPageIndex)} className="mt-2" size="sm" disabled={isLoadingPdfPage}>Process This Page</Button>
                       }
                      <p className="text-xs text-muted-foreground mt-2">If this takes too long, the page might be complex or an error occurred.</p>
                    </div>
                  ): activeDocument.type === 'image' && !currentSubPage?.imageDataUrl && !isLoadingDocument ? (
                     // Placeholder for Image type when image data is missing
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                        <ImageIcon className="w-16 h-16 text-destructive mb-4" />
                        <p>Image data is missing or failed to load for display.</p>
                    </div>
                  ) : (
                     // Fallback if no active document and not loading (should be rare if UI logic is right)
                     !isLoadingDocument && !activeDocument &&
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                      <ImageIcon className="w-16 h-16 text-primary mb-4" />
                      <p>No document loaded in this session. Please upload a document above to begin.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
             {/* Extracted Text Area - Conditionally render based on text availability and loading states */}
             {(textToRead || (isLoadingPdfPage && activeDocument.type === 'pdf' && currentSubPage?.extractedText?.startsWith("Loading")) || (activeDocument.type ==='image' && (activeDocument.extractedText === "Performing OCR..." || activeDocument.extractedText === "Processing uploaded image..."))) && (
                <Card>
                <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-lg">Extracted Text (for current session)</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                    <div
                        className={cn(
                            "min-h-[100px] max-h-60 overflow-y-auto p-2 border rounded-md bg-muted/30 whitespace-pre-wrap text-sm select-text",
                            textToRead.startsWith("Error:") && "text-destructive bg-destructive/10",
                            (textToRead.startsWith("Processing") || textToRead.startsWith("Loading") || textToRead.startsWith("Please wait") || textToRead.startsWith("Extracting text") ) && "text-muted-foreground italic"
                        )}
                    >
                    {/* Handle different loading/text states */}
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
                        disabled={ // Disable if no doc, loading, or text is invalid/pending
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
          
          {/* Message when document is being processed for the session */}
          {isLoadingDocument && activeDocument && <p className="text-sm text-muted-foreground text-center">Processing file for session...</p>}

          {/* Placeholder when no document is loaded */}
          {!activeDocument && !isLoadingDocument &&(
            <Card className="text-center">
              <CardHeader>
                <CardTitle>No File Loaded for This Session</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">Upload a document above to begin reading in this session. It will also be sent to your local helper service for persistent storage.</p>
                <BookOpen className="mx-auto my-4 h-12 w-12 text-muted-foreground" />
              </CardContent>
            </Card>
          )}
      </div>

      {/* Controls Area - Only show if a document is active and not currently being loaded */}
      {activeDocument && !isLoadingDocument && (
        <div className="space-y-4">
            <Card>
            <CardHeader className="p-4">
                <CardTitle className="text-lg">Controls</CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {/* PDF Navigation Controls */}
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
                      type="text" // Using text to allow easier clearing and input, validation handles numeric
                      inputMode="numeric" // Hint for mobile keyboards
                      className="h-8 w-12 text-center text-sm px-1"
                      value={jumpToPageInput}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setJumpToPageInput(newValue); // Update displayed input immediately

                        const doc = activeDocument; // Ensure we are working with the current state
                        if (doc && doc.type === 'pdf' && doc.numPages > 0) {
                          const pageNumOneBased = parseInt(newValue, 10);
                          if (!isNaN(pageNumOneBased) && pageNumOneBased >= 1 && pageNumOneBased <= doc.numPages) {
                            const pageNumZeroBased = pageNumOneBased - 1;
                            if (pageNumZeroBased !== currentPdfInternalPageIndex) {
                              stopSpeechFnRef.current(true); // Stop speech before navigating
                              setCurrentPdfInternalPageIndex(pageNumZeroBased);
                            }
                          }
                          // If not valid numeric, or out of range, onBlur will handle resetting or correcting.
                        }
                      }}
                      onBlur={handleJumpToPageOnBlur} // Validate and finalize on blur
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

              {/* TTS Controls - Conditionally render if text is available and not in critical loading states */}
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

