
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import type { MangaDocument, MangaImageFile, MangaPdfFile, MangaSubPage, TTSSettings, TTSVoice } from '@/types';
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
import { ChevronLeft, ChevronRight, Cloud, FileText, Loader2, Play, Pause, Smartphone, StopCircle, UploadCloud, Volume2, XCircle, BookOpen } from 'lucide-react';
import * as LocalStorage from '@/lib/localStorageService';
import { cn } from '@/lib/utils';

import { GlobalWorkerOptions, getDocument, version as pdfjsVersion } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';


export function MangaRoom() {
  const { toast } = useToast();
  const [mangaDocuments, setMangaDocuments] = useState<MangaDocument[]>([]);
  const [currentDocumentIndex, setCurrentDocumentIndex] = useState(0);
  const [currentPdfInternalPageIndex, setCurrentPdfInternalPageIndex] = useState(0); // 0-based for PDF rendering

  const [ttsSettings, setTtsSettings] = useState<TTSSettings>(LocalStorage.defaultTTSSettings);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false); // For initial PDF load or image OCR
  const [isLoadingPdfPage, setIsLoadingPdfPage] = useState(false); // For rendering subsequent PDF pages
  const [isLoadingTTS, setIsLoadingTTS] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);
  
  const [sentenceSegments, setSentenceSegments] = useState<string[]>([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number>(-1);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const pdfDocCacheRef = useRef<Record<string, PDFDocumentProxy>>({}); // Cache for PDFDocumentProxy objects

  useEffect(() => {
    if (typeof window !== 'undefined') {
      GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
    }
  }, []);

  useEffect(() => {
    setMangaDocuments(LocalStorage.loadDocuments());
    setCurrentDocumentIndex(LocalStorage.loadCurrentDocumentIndex());
    setCurrentPdfInternalPageIndex(LocalStorage.loadCurrentPdfPageIndex());
    setTtsSettings(LocalStorage.loadTTSSettings());
  }, []);

  useEffect(() => {
    LocalStorage.saveDocuments(mangaDocuments);
  }, [mangaDocuments]);

  useEffect(() => {
    LocalStorage.saveCurrentDocumentIndex(currentDocumentIndex);
  }, [currentDocumentIndex]);
  
  useEffect(() => {
    LocalStorage.saveCurrentPdfPageIndex(currentPdfInternalPageIndex);
  }, [currentPdfInternalPageIndex]);

  useEffect(() => {
    LocalStorage.saveTTSSettings(ttsSettings);
  }, [ttsSettings]);

  const stopSpeech = useCallback(() => {
    if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    } else if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      if (audioPlayerRef.current.src && audioPlayerRef.current.readyState >= HTMLMediaElement.HAVE_METADATA) {
         try {
            audioPlayerRef.current.currentTime = 0;
         } catch (e) {
            // console.warn("Could not set audio currentTime on stop", e);
         }
      }
    }
    if (utteranceRef.current) {
      utteranceRef.current.onend = null; 
      utteranceRef.current.onboundary = null;
    }
    setIsSpeaking(false);
    setIsLoadingTTS(false);
    setCurrentSentenceIndex(-1);
    setSentenceSegments([]);
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
      if (!ttsSettings.voiceURI && voices.length > 0) {
        const defaultVoice = voices.find(v => v.lang === ttsSettings.language && v.default) || voices.find(v => v.lang === ttsSettings.language) || voices.find(v => v.default) || voices[0];
        if (defaultVoice) {
          setTtsSettings(prev => ({ ...prev, voiceURI: defaultVoice.voiceURI }));
        }
      }
    }
  }, [ttsSettings.language, ttsSettings.voiceURI]);

  useEffect(() => {
    populateVoiceList();
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = populateVoiceList;
    }
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
      stopSpeech(); 
    };
  }, [populateVoiceList, stopSpeech]);

  const renderAndProcessPdfPage = useCallback(async (docId: string, pageNumToRender: number) => { // pageNumToRender is 0-based
    const docIndex = mangaDocuments.findIndex(d => d.id === docId);
    if (docIndex === -1) {
      setIsLoadingPdfPage(false); 
      return;
    }

    const pdfDocToProcess = mangaDocuments[docIndex] as MangaPdfFile;
    if (pdfDocToProcess?.type !== 'pdf' || pageNumToRender < 0 || pageNumToRender >= pdfDocToProcess.numPages) {
      setIsLoadingPdfPage(false); 
      return;
    }

    if (pdfDocToProcess.processedPages[pageNumToRender]?.imageDataUrl && pdfDocToProcess.processedPages[pageNumToRender]?.extractedText) {
       setIsLoadingPdfPage(false);
       return;
    }
    
    setIsLoadingPdfPage(true);

    try {
      let pdfDocInstance = pdfDocCacheRef.current[pdfDocToProcess.id];
      if (!pdfDocInstance) {
        const loadingTask = getDocument({data: pdfDocToProcess.pdfDataUrl.split(',')[1]}); 
        pdfDocInstance = await loadingTask.promise;
        pdfDocCacheRef.current[pdfDocToProcess.id] = pdfDocInstance;
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

        setMangaDocuments(prevDocs => prevDocs.map(doc => {
          if (doc.id === pdfDocToProcess.id && doc.type === 'pdf') {
            const updatedProcessedPages = [...doc.processedPages];
            updatedProcessedPages[pageNumToRender] = newSubPage;
            return { ...doc, processedPages: updatedProcessedPages };
          }
          return doc;
        }));
        toast({ title: "PDF Page Processed", description: `Page ${pageNumToRender + 1} text extracted.` });
      } else {
        throw new Error("Canvas context not available for PDF page rendering.");
      }
    } catch (error: any) {
      console.error("Error processing PDF page:", error);
      toast({ variant: "destructive", title: "PDF Page Error", description: error.message || `Failed to process page ${pageNumToRender + 1}.` });
       setMangaDocuments(prevDocs => prevDocs.map(doc => {
          if (doc.id === pdfDocToProcess.id && doc.type === 'pdf') {
            const updatedProcessedPages = [...doc.processedPages];
            updatedProcessedPages[pageNumToRender] = { imageDataUrl: '', extractedText: 'Error processing this page.'};
            return { ...doc, processedPages: updatedProcessedPages };
          }
          return doc;
        }));
    } finally {
      setIsLoadingPdfPage(false);
    }
  }, [mangaDocuments, toast]);


  useEffect(() => {
    const currentDoc = mangaDocuments[currentDocumentIndex];
    if (currentDoc?.type === 'pdf' && currentDoc.numPages > 0 && currentPdfInternalPageIndex < currentDoc.numPages) {
      if (!currentDoc.processedPages[currentPdfInternalPageIndex]?.imageDataUrl &&
          !currentDoc.processedPages[currentPdfInternalPageIndex]?.extractedText &&
          !isLoadingPdfPage
         ) {
         renderAndProcessPdfPage(currentDoc.id, currentPdfInternalPageIndex);
      }
    }
  }, [currentDocumentIndex, currentPdfInternalPageIndex, mangaDocuments, renderAndProcessPdfPage, isLoadingPdfPage]);


  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    stopSpeech();
    setIsLoadingDocument(true);
    const commonPageId = Date.now().toString();
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
        const ocrResult = await performOCR(imageDataUrl);
        const newImageDoc: MangaImageFile = {
          id: commonPageId,
          title: file.name,
          type: 'image',
          imageDataUrl,
          extractedText: 'extractedText' in ocrResult ? ocrResult.extractedText : "OCR failed.",
        };
        setMangaDocuments(prev => {
            const newDocs = [...prev, newImageDoc];
            setCurrentDocumentIndex(newDocs.length -1);
            return newDocs;
        });
        toast({ title: "Image OCR Success", description: "Text extracted." });
        setIsLoadingDocument(false);
      };
      reader.onerror = () => {
        toast({ variant: "destructive", title: "File Read Error", description: "Could not read the image file." });
        setIsLoadingDocument(false);
      };
      reader.readAsDataURL(file);

    } else if (file.type === 'application/pdf') {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const pdfBase64DataUrl = e.target?.result as string;
         if (!pdfBase64DataUrl || !pdfBase64DataUrl.startsWith('data:application/pdf;base64,')) {
            toast({ variant: "destructive", title: "Upload Error", description: "Invalid or corrupted PDF file processed." });
            setIsLoadingDocument(false);
            if (fileInputTarget) fileInputTarget.value = '';
            return;
        }

        try {
          // Pass only the base64 part to getDocument for data URLs
          const loadingTask = getDocument({data: pdfBase64DataUrl.split(',')[1]});
          const pdf = await loadingTask.promise;
          pdfDocCacheRef.current[commonPageId] = pdf;

          const newPdfDoc: MangaPdfFile = {
            id: commonPageId,
            title: file.name,
            type: 'pdf',
            pdfDataUrl: pdfBase64DataUrl, 
            numPages: pdf.numPages,
            processedPages: new Array(pdf.numPages).fill(null),
          };
          
          setMangaDocuments(prev => {
            const newDocs = [...prev, newPdfDoc];
            setCurrentDocumentIndex(newDocs.length - 1);
            setCurrentPdfInternalPageIndex(0);
            return newDocs;
          });
          toast({ title: "PDF Uploaded", description: `${file.name} (${pdf.numPages} pages). Processing first page...` });

        } catch (pdfLoadError: any) {
          console.error("Error loading PDF:", pdfLoadError);
          toast({ variant: "destructive", title: "PDF Load Error", description: pdfLoadError.message || "Failed to load PDF." });
        } finally {
          setIsLoadingDocument(false);
        }
      };
      reader.onerror = () => {
        toast({ variant: "destructive", title: "File Read Error", description: "Could not process the PDF file content." });
        setIsLoadingDocument(false);
        if (fileInputTarget) fileInputTarget.value = '';
      };
      reader.readAsDataURL(file); // Read as Base64 Data URL
      
    } else {
      toast({ variant: "destructive", title: "Unsupported File Type", description: "Please upload an image or a PDF file." });
      setIsLoadingDocument(false);
    }
    
    if (fileInputTarget) {
        fileInputTarget.value = '';
    }
  };

  const currentDoc = mangaDocuments[currentDocumentIndex];
  let currentSubPage: MangaSubPage | null | undefined = null;
  let textToRead = "";

  if (currentDoc) {
    if (currentDoc.type === 'image') {
      currentSubPage = {imageDataUrl: currentDoc.imageDataUrl, extractedText: currentDoc.extractedText};
      textToRead = currentDoc.extractedText || "";
    } else if (currentDoc.type === 'pdf' && currentDoc.processedPages) {
      currentSubPage = currentDoc.processedPages[currentPdfInternalPageIndex];
      textToRead = currentSubPage?.extractedText || "";
      if (!textToRead && !isLoadingPdfPage && currentDoc.numPages > 0) {
         if (!currentSubPage) {
            textToRead = "Processing PDF page, please wait. You can also manually select text from this message to read aloud.";
         } else {
            textToRead = "No text extracted for this page yet. Select text manually if available, or wait if processing.";
         }
      } else if (isLoadingPdfPage) {
         textToRead = "Loading PDF page content...";
      }
    }
  }


  const playSpeech = async () => {
    setIsLoadingTTS(true); 
    setIsSpeaking(false);  

    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const effectiveTextToRead = selectedText || textToRead;

    if (!effectiveTextToRead || isLoadingPdfPage) {
      toast({ variant: "destructive", title: "No Text", description: "No text available to read or PDF page is loading." });
      setIsLoadingTTS(false);
      return;
    }
    stopSpeech(); 
    setIsSpeaking(true);

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
        if (newIdx !== -1 && newIdx !== currentSentenceIndex) { 
          setCurrentSentenceIndex(newIdx);
        }
      };
      
      utterance.onend = () => {
        setIsSpeaking(false);
        setIsLoadingTTS(false);
        setCurrentSentenceIndex(-1); 
      };
      utterance.onerror = (event) => {
        toast({ variant: "destructive", title: "TTS Error", description: event.error || "Failed to play speech." });
        setIsSpeaking(false);
        setIsLoadingTTS(false);
        setCurrentSentenceIndex(-1);
        setSentenceSegments([]);
      };
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);

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
          setIsSpeaking(false);
          setIsLoadingTTS(false);
        } else {
            throw new Error("Invalid response from cloud TTS");
        }
      } catch (error: any) {
        toast({ variant: "destructive", title: "Cloud TTS Request Failed", description: error.message || "Unknown error." });
        setIsSpeaking(false);
        setIsLoadingTTS(false);
      }
    }
  };

  const pauseSpeech = () => {
    if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
      window.speechSynthesis.pause();
      setIsSpeaking(false); 
    } else if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      setIsSpeaking(false);
    }
  };
  
  const resumeSpeech = () => {
     if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsSpeaking(true);
    } else if (audioPlayerRef.current && audioPlayerRef.current.paused) {
      audioPlayerRef.current.play().catch(err => {
         toast({variant: "destructive", title: "Audio Playback Error", description: err.message});
         setIsSpeaking(false); 
      });
      setIsSpeaking(true);
    }
  };
  
  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;

    const handleAudioEnded = () => {
      setIsSpeaking(false);
      setIsLoadingTTS(false);
    };
    const handleAudioCanPlayThrough = () => {
      if (ttsSettings.type === 'cloud' && isSpeaking) { 
         setIsLoadingTTS(false);
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
      setIsSpeaking(false);
      setIsLoadingTTS(false);
    };
    
    const handleAudioPlaying = () => {
        if (ttsSettings.type === 'cloud') {
            setIsLoadingTTS(false); 
        }
    };
    
    player.addEventListener('ended', handleAudioEnded);
    player.addEventListener('canplaythrough', handleAudioCanPlayThrough); 
    player.addEventListener('error', handleAudioError);
    player.addEventListener('playing', handleAudioPlaying);


    return () => {
      player.removeEventListener('ended', handleAudioEnded);
      player.removeEventListener('canplaythrough', handleAudioCanPlayThrough);
      player.removeEventListener('error', handleAudioError);
      player.removeEventListener('playing', handleAudioPlaying);
      
      if (player.src && !player.paused) { 
        player.pause();
      }
      if (player.src) { 
        player.src = ""; 
      }
      if (audioPlayerRef.current === player) { 
        audioPlayerRef.current = null;
      }
    };
  }, [ttsSettings.type, isSpeaking, toast, stopSpeech]);


  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    stopSpeech(); 
    setTtsSettings(prev => ({ ...prev, [key]: value }));
    if (key === 'type') { 
      setSentenceSegments([]);
      setCurrentSentenceIndex(-1);
    }
  };

  const navigatePage = (direction: 'next' | 'prev') => {
    stopSpeech();
    setIsLoadingTTS(false); 
    setIsSpeaking(false);   
    setSentenceSegments([]);
    setCurrentSentenceIndex(-1);

    const doc = mangaDocuments[currentDocumentIndex];
    if (!doc) return;

    if (doc.type === 'pdf') {
      let newPdfPage = currentPdfInternalPageIndex;
      if (direction === 'next') {
        if (currentPdfInternalPageIndex < doc.numPages - 1) {
          newPdfPage = currentPdfInternalPageIndex + 1;
        } else if (currentDocumentIndex < mangaDocuments.length - 1) { 
          setCurrentDocumentIndex(currentDocumentIndex + 1);
          setCurrentPdfInternalPageIndex(0); 
          return;
        } else { return; } 
      } else { 
        if (currentPdfInternalPageIndex > 0) {
          newPdfPage = currentPdfInternalPageIndex - 1;
        } else if (currentDocumentIndex > 0) { 
          const prevDocIndex = currentDocumentIndex -1;
          const prevDoc = mangaDocuments[prevDocIndex];
          setCurrentDocumentIndex(prevDocIndex);
          setCurrentPdfInternalPageIndex(prevDoc.type === 'pdf' ? prevDoc.numPages - 1 : 0);
          return;
        } else { return; } 
      }
      setCurrentPdfInternalPageIndex(newPdfPage);
    } else { 
      let newDocIndex = currentDocumentIndex;
      if (direction === 'next' && currentDocumentIndex < mangaDocuments.length - 1) {
        newDocIndex = currentDocumentIndex + 1;
      } else if (direction === 'prev' && currentDocumentIndex > 0) {
        newDocIndex = currentDocumentIndex - 1;
      } else { return; }
      setCurrentDocumentIndex(newDocIndex);
      setCurrentPdfInternalPageIndex(0); 
    }
  };
  
  const removeDocument = (docId: string) => {
    stopSpeech();
    setIsLoadingTTS(false);
    setIsSpeaking(false);
    setSentenceSegments([]);
    setCurrentSentenceIndex(-1);

    delete pdfDocCacheRef.current[docId]; 

    const newDocs = mangaDocuments.filter(d => d.id !== docId);
    setMangaDocuments(newDocs);

    if (newDocs.length === 0) {
      setCurrentDocumentIndex(0);
      setCurrentPdfInternalPageIndex(0);
    } else {
      const oldIndex = mangaDocuments.findIndex(d => d.id === docId);
      let newCurrentDocIndex = currentDocumentIndex;

      if (oldIndex < currentDocumentIndex) {
        newCurrentDocIndex = currentDocumentIndex - 1;
      } else if (oldIndex === currentDocumentIndex) {
        newCurrentDocIndex = Math.max(0, currentDocumentIndex - 1);
      }
      
      if (newCurrentDocIndex >= newDocs.length) {
         newCurrentDocIndex = Math.max(0, newDocs.length - 1);
      }
      setCurrentDocumentIndex(newCurrentDocIndex);
      
      const newCurrentActiveDoc = newDocs[newCurrentDocIndex];
      if (newCurrentActiveDoc && newCurrentActiveDoc.type === 'pdf') {
         setCurrentPdfInternalPageIndex(0);
      } else {
         setCurrentPdfInternalPageIndex(0); 
      }
    }
  };

  const canPlaySelectedText = !!(typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '') || !!textToRead;


  const getPageInfo = () => {
    if (!currentDoc) return "No document loaded";
    if (currentDoc.type === 'image') {
      return `Image ${currentDocumentIndex + 1} of ${mangaDocuments.length}`;
    }
    if (currentDoc.type === 'pdf') {
      return `Page ${currentPdfInternalPageIndex + 1} of ${currentDoc.numPages} (Document ${currentDocumentIndex + 1} of ${mangaDocuments.length})`;
    }
    return "";
  };

  const effectiveTextToReadForControls = (typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '') || textToRead;

  return (
    <div className="container mx-auto p-4 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Upload Manga Page or PDF</CardTitle>
          <CardDescription>Upload an image (for OCR) or a PDF document. PDF pages will be processed one by one.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="manga-upload">Manga File</Label>
            <Input id="manga-upload" type="file" accept="image/*,application/pdf" onChange={handleFileUpload} disabled={isLoadingDocument || isLoadingPdfPage} />
          </div>
          {(isLoadingDocument || isLoadingPdfPage) && <Progress value={undefined} className="w-full mt-2" />}
        </CardContent>
      </Card>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left Column: Reading Area + Extracted Text */}
        <div className="flex-grow space-y-6 lg:w-2/3">
          {mangaDocuments.length > 0 && currentDoc && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Viewing: {currentDoc.title || `Document ${currentDocumentIndex + 1}`}</span>
                  <Button variant="ghost" size="icon" onClick={() => removeDocument(currentDoc.id)} aria-label="Remove document" disabled={isLoadingDocument || isLoadingPdfPage || isLoadingTTS || isSpeaking}>
                    <XCircle className="h-5 w-5 text-destructive" />
                  </Button>
                </CardTitle>
                <CardDescription>
                  {getPageInfo()}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative aspect-[2/3] w-full max-w-md mx-auto bg-muted rounded-md overflow-hidden shadow-lg">
                  {isLoadingPdfPage && !currentSubPage?.imageDataUrl && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10">
                        <Loader2 className="h-12 w-12 animate-spin text-primary" />
                        <p className="mt-2 text-muted-foreground">Loading PDF page...</p>
                    </div>
                  )}
                  {currentSubPage?.imageDataUrl ? (
                    <Image
                      src={currentSubPage.imageDataUrl}
                      alt={currentDoc.title || `Page content`}
                      fill 
                      style={{ objectFit: "contain" }} 
                      data-ai-hint="manga page comic"
                      priority={true}
                      key={currentSubPage.imageDataUrl} // Add key for re-renders
                    />
                  ) : currentDoc.type === 'pdf' && !isLoadingPdfPage ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                      <BookOpen className="w-16 h-16 text-primary mb-4" />
                      <p className="font-semibold">{currentDoc.title || 'PDF Document'}</p>
                      <p className="text-sm text-muted-foreground">
                        { currentDoc.numPages > 0 ? `Processing page ${currentPdfInternalPageIndex + 1}...` : "Empty PDF or error loading."}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">If this takes too long, the page might be complex or an error occurred.</p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-center p-4">
                      <FileText className="w-16 h-16 text-primary mb-4" />
                      <p>No content to display for this page, or document is not an image/PDF.</p>
                    </div>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <Button onClick={() => navigatePage('prev')} 
                    disabled={
                        (currentDoc?.type === 'image' && currentDocumentIndex === 0) ||
                        (currentDoc?.type === 'pdf' && currentDocumentIndex === 0 && currentPdfInternalPageIndex === 0) ||
                        isLoadingTTS || isSpeaking || isLoadingPdfPage || isLoadingDocument
                    }>
                    <ChevronLeft /> Previous
                  </Button>
                  <Button onClick={() => navigatePage('next')} 
                    disabled={
                        (currentDoc?.type === 'image' && currentDocumentIndex === mangaDocuments.length - 1) ||
                        (currentDoc?.type === 'pdf' && currentDoc.numPages > 0 && currentDocumentIndex === mangaDocuments.length - 1 && currentPdfInternalPageIndex === currentDoc.numPages - 1) ||
                        (currentDoc?.type === 'pdf' && currentDoc.numPages === 0 && currentDocumentIndex === mangaDocuments.length -1 ) || 
                        isLoadingTTS || isSpeaking || isLoadingPdfPage || isLoadingDocument
                    }>
                    Next <ChevronRight />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          
          {textToRead && (
            <Card>
              <CardHeader>
                <CardTitle>Extracted Text</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-60 overflow-y-auto p-2 border rounded-md bg-muted/50 whitespace-pre-wrap text-sm">
                  {isLoadingPdfPage && !currentSubPage?.extractedText ? "Loading page text..." : 
                    (ttsSettings.type === 'local' && sentenceSegments.length > 0 && isSpeaking) ? (
                      sentenceSegments.map((segment, index) => (
                        <span
                          key={index}
                          className={cn(
                            index === currentSentenceIndex && "text-accent font-semibold"
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
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Floating TTS Controls */}
        {effectiveTextToReadForControls && ( 
          <div className="lg:w-72 lg:sticky lg:top-16 h-fit">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Volume2 className="text-primary" /> TTS Controls</CardTitle>
                <CardDescription>Configure and play the text. Highlighting for local TTS.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-4">
                  <div>
                    <Label htmlFor="tts-type">TTS Engine</Label>
                    <Select value={ttsSettings.type} onValueChange={(v) => handleSettingChange('type', v as 'local' | 'cloud')} disabled={isSpeaking || isLoadingTTS}>
                      <SelectTrigger id="tts-type">
                        <SelectValue placeholder="Select TTS type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local"><div className="flex items-center gap-2"><Smartphone /> Local Browser TTS</div></SelectItem>
                        <SelectItem value="cloud"><div className="flex items-center gap-2"><Cloud /> Cloud TTS</div></SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="tts-language">Language</Label>
                    <Input 
                        id="tts-language" 
                        value={ttsSettings.language} 
                        onChange={(e) => handleSettingChange('language', e.target.value)}
                        placeholder="e.g. en-US, ja-JP"
                        disabled={isSpeaking || isLoadingTTS}
                      />
                  </div>
                </div>

                {ttsSettings.type === 'local' && availableVoices.length > 0 && (
                  <div>
                    <Label htmlFor="tts-voice">Voice (Local)</Label>
                    <Select value={ttsSettings.voiceURI} onValueChange={(v) => handleSettingChange('voiceURI', v)} disabled={isSpeaking || isLoadingTTS}>
                      <SelectTrigger id="tts-voice">
                        <SelectValue placeholder="Select voice" />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {availableVoices.filter(v => v.lang.startsWith(ttsSettings.language.split('-')[0])).map(voice => (
                          <SelectItem key={voice.voiceURI || voice.name} value={voice.voiceURI}>
                            {voice.name} ({voice.lang}) {voice.default ? "[Default]" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="tts-rate">Rate: {ttsSettings.rate.toFixed(1)}</Label>
                  <Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={isSpeaking || isLoadingTTS}/>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tts-pitch">Pitch: {ttsSettings.pitch.toFixed(1)}</Label>
                  <Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={isSpeaking || isLoadingTTS}/>
                </div>

                <div className="flex flex-col items-start gap-2">
                  {!isSpeaking && !isLoadingTTS && (
                    <Button onClick={playSpeech} disabled={!canPlaySelectedText || isLoadingPdfPage || isLoadingDocument} className="w-full">
                      <Play className="mr-2" /> Play {(typeof window !== 'undefined' && window.getSelection()?.toString().trim()) ? "Selected" : "All"}
                    </Button>
                  )}
                  {isSpeaking && !isLoadingTTS && ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && !window.speechSynthesis.paused &&(
                    <Button onClick={pauseSpeech} variant="outline" className="w-full">
                      <Pause className="mr-2" /> Pause
                    </Button>
                  )}
                  {!isSpeaking && !isLoadingTTS && ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.paused && (
                    <Button onClick={resumeSpeech} variant="outline" className="w-full">
                      <Play className="mr-2" /> Resume
                    </Button>
                  )}
                  {(isSpeaking || isLoadingTTS) && (
                    <Button onClick={stopSpeech} variant="destructive" className="w-full">
                      <StopCircle className="mr-2" /> Stop
                    </Button>
                  )}
                  {(isLoadingTTS || isLoadingDocument || isLoadingPdfPage) && <Loader2 className="animate-spin" />}
                </div>
                {(typeof window !== 'undefined' && window.getSelection()?.toString().trim()) && <p className="text-sm text-muted-foreground italic">Reading selected: "{(window.getSelection()?.toString().trim() || "").substring(0,50)}..."</p>}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
      
      {mangaDocuments.length === 0 && !isLoadingDocument && (
        <Card className="text-center">
          <CardHeader>
            <CardTitle>No Manga Files</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Upload a manga image or a PDF document to get started.</p>
            <UploadCloud className="mx-auto my-4 h-12 w-12 text-muted-foreground" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

