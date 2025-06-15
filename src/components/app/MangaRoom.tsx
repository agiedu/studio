
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
      setIsLoadingPdfPage(false); // Ensure loading state is reset
      return;
    }

    const pdfDocToProcess = mangaDocuments[docIndex] as MangaPdfFile;
    if (pdfDocToProcess?.type !== 'pdf' || pageNumToRender < 0 || pageNumToRender >= pdfDocToProcess.numPages) {
      setIsLoadingPdfPage(false); // Ensure loading state is reset
      return;
    }

    // Skip if already processed
    if (pdfDocToProcess.processedPages[pageNumToRender]?.imageDataUrl && pdfDocToProcess.processedPages[pageNumToRender]?.extractedText) {
       setIsLoadingPdfPage(false);
       return;
    }
    
    setIsLoadingPdfPage(true);

    try {
      let pdfDocInstance = pdfDocCacheRef.current[pdfDocToProcess.id];
      if (!pdfDocInstance) {
        const loadingTask = getDocument(pdfDocToProcess.pdfDataUrl); // Use the stored original PDF data URL
        pdfDocInstance = await loadingTask.promise;
        pdfDocCacheRef.current[pdfDocToProcess.id] = pdfDocInstance;
      }

      const page: PDFPageProxy = await pdfDocInstance.getPage(pageNumToRender + 1); // PDF.js is 1-based
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
            // Ensure object is created even on error to prevent undefined access
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
      // Check if the page is already processed or if it's currently being loaded to avoid re-triggering
      if (!currentDoc.processedPages[currentPdfInternalPageIndex]?.imageDataUrl &&
          !currentDoc.processedPages[currentPdfInternalPageIndex]?.extractedText &&
          !isLoadingPdfPage // Add this check
         ) {
         renderAndProcessPdfPage(currentDoc.id, currentPdfInternalPageIndex);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDocumentIndex, currentPdfInternalPageIndex, mangaDocuments, renderAndProcessPdfPage, isLoadingPdfPage]); // isLoadingPdfPage added


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
        if (!e.target?.result) {
            toast({ variant: "destructive", title: "Upload Error", description: "Failed to read PDF file." });
            setIsLoadingDocument(false);
            if (fileInputTarget) fileInputTarget.value = '';
            return;
        }
        try {
          const arrayBuffer = e.target.result as ArrayBuffer;
          const loadingTask = getDocument(new Uint8Array(arrayBuffer)); // Use Uint8Array for pdf.js
          const pdf = await loadingTask.promise;
          pdfDocCacheRef.current[commonPageId] = pdf;

          // Create a Blob and Object URL for storing and re-use with pdfjs-dist
          // This is more memory efficient than storing large base64 data URLs for PDFs in state/localStorage
          const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
          const objectURL = URL.createObjectURL(blob); // This URL needs to be managed (revoked) when doc is removed

          const newPdfDoc: MangaPdfFile = {
            id: commonPageId,
            title: file.name,
            type: 'pdf',
            pdfDataUrl: objectURL, // Store the object URL. Original file data is not kept in state.
            numPages: pdf.numPages,
            processedPages: new Array(pdf.numPages).fill(null),
          };
          
          setMangaDocuments(prev => {
            const newDocs = [...prev, newPdfDoc];
            setCurrentDocumentIndex(newDocs.length - 1);
            setCurrentPdfInternalPageIndex(0);
            return newDocs;
          });
          // renderAndProcessPdfPage will be called by the useEffect hook for the first page
          toast({ title: "PDF Uploaded", description: `${file.name} (${pdf.numPages} pages). Processing first page...` });

        } catch (error: any) {
          console.error("Error loading PDF:", error);
          toast({ variant: "destructive", title: "PDF Load Error", description: error.message || "Failed to load PDF." });
        } finally {
          setIsLoadingDocument(false);
        }
      };
      reader.onerror = () => {
        toast({ variant: "destructive", title: "File Read Error", description: "Could not read the PDF file." });
        setIsLoadingDocument(false);
      };
      reader.readAsArrayBuffer(file);
      
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
         // Check if it's just not processed yet vs. truly empty
         if (!currentSubPage) {
            textToRead = "Processing PDF page or select text manually if available.";
         } else {
            textToRead = "No text extracted for this page. Select text manually if available.";
         }
      } else if (isLoadingPdfPage) {
         textToRead = "Loading PDF page content...";
      }
    }
  }


  const playSpeech = async () => {
    setIsLoadingTTS(true); // Moved to ensure it's set before any async ops
    setIsSpeaking(false);  // Reset speaking state

    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const effectiveTextToRead = selectedText || textToRead;

    if (!effectiveTextToRead || isLoadingPdfPage) {
      toast({ variant: "destructive", title: "No Text", description: "No text available to read or PDF page is loading." });
      setIsLoadingTTS(false);
      return;
    }
    stopSpeech(); 
    // setIsLoadingTTS(true); // Already set above
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
      setCurrentSentenceIndex(0); // Start with the first sentence highlighted

      utterance.onboundary = (event) => {
        let cumulativeLength = 0;
        let newIdx = -1;
        // Find the segment corresponding to the current charIndex
        for (let i = 0; i < segments.length; i++) {
          if (event.charIndex >= cumulativeLength && event.charIndex < cumulativeLength + segments[i].length) {
            newIdx = i;
            break;
          }
          cumulativeLength += segments[i].length;
        }
        if (newIdx !== -1 && newIdx !== currentSentenceIndex) { // Avoid redundant state updates
          setCurrentSentenceIndex(newIdx);
        }
      };
      
      utterance.onend = () => {
        setIsSpeaking(false);
        setIsLoadingTTS(false);
        setCurrentSentenceIndex(-1); // Clear highlight on end
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
      // For local TTS, loading is usually very fast, so we can set isLoadingTTS to false after speaking starts
      // However, SpeechSynthesis API doesn't have a reliable 'onstart' that guarantees audio output.
      // We'll rely on onend/onerror to set it to false. If speech starts, isSpeaking handles button states.
      // This assumes speech will start almost immediately.
      // Consider setting isLoadingTTS to false here if immediate feedback is needed,
      // but it might be slightly inaccurate if there's a delay before actual speech.
      // For now, we'll let onend/onerror handle it.

    } else { // Cloud TTS
      setSentenceSegments([]); 
      setCurrentSentenceIndex(-1);
      try {
        const cloudResult = await getCloudSpeech(effectiveTextToRead, ttsSettings.language);
        if ('audioUrl' in cloudResult && audioPlayerRef.current) {
            audioPlayerRef.current.src = cloudResult.audioUrl;
            // `isSpeaking` is already true, `isLoadingTTS` will be set to false by audio player events
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
    const handleAudioCanPlay = () => {
      // This means enough data is loaded to start playing.
      // If we initiated cloud TTS and were waiting, we can now set loading to false.
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
            setIsLoadingTTS(false); // Ensure loading is false once playback starts
        }
    };
    
    player.addEventListener('ended', handleAudioEnded);
    player.addEventListener('canplaythrough', handleAudioCanPlay); // preferred over canplay for smoother start
    player.addEventListener('error', handleAudioError);
    player.addEventListener('playing', handleAudioPlaying);


    return () => {
      player.removeEventListener('ended', handleAudioEnded);
      player.removeEventListener('canplaythrough', handleAudioCanPlay);
      player.removeEventListener('error', handleAudioError);
      player.removeEventListener('playing', handleAudioPlaying);
      
      if (player && player.src && !player.paused) { // Check if player.src is not null before pausing
        player.pause();
      }
      if (player && player.src) { // Check if player.src is not null before resetting src
         // Revoke object URL if it's from a PDF Blob or other blob source
        if (player.src.startsWith('blob:')) {
          URL.revokeObjectURL(player.src);
        }
        player.src = ""; 
      }
      // Ensure audioPlayerRef is not accessed if it might be null during cleanup
      if (audioPlayerRef.current === player) { 
        audioPlayerRef.current = null;
      }
    };
  }, [ttsSettings.type, isSpeaking, toast]); // Added isSpeaking and toast to dependencies


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
        } else if (currentDocumentIndex < mangaDocuments.length - 1) { // End of PDF, go to next document
          setCurrentDocumentIndex(currentDocumentIndex + 1);
          setCurrentPdfInternalPageIndex(0); // Reset to first page of new doc if it's PDF
          return;
        } else { return; } // No more pages or documents
      } else { // prev
        if (currentPdfInternalPageIndex > 0) {
          newPdfPage = currentPdfInternalPageIndex - 1;
        } else if (currentDocumentIndex > 0) { // Start of PDF, go to prev document
          const prevDocIndex = currentDocumentIndex -1;
          const prevDoc = mangaDocuments[prevDocIndex];
          setCurrentDocumentIndex(prevDocIndex);
          setCurrentPdfInternalPageIndex(prevDoc.type === 'pdf' ? prevDoc.numPages - 1 : 0);
          return;
        } else { return; } // No more pages or documents
      }
      setCurrentPdfInternalPageIndex(newPdfPage);
    } else { // Image document
      let newDocIndex = currentDocumentIndex;
      if (direction === 'next' && currentDocumentIndex < mangaDocuments.length - 1) {
        newDocIndex = currentDocumentIndex + 1;
      } else if (direction === 'prev' && currentDocumentIndex > 0) {
        newDocIndex = currentDocumentIndex - 1;
      } else { return; }
      setCurrentDocumentIndex(newDocIndex);
      // For image documents, there's no internal page index to reset other than what changing currentDocumentIndex implies
      setCurrentPdfInternalPageIndex(0); // Reset for consistency, though not directly used by image type
    }
  };
  
  const removeDocument = (docId: string) => {
    stopSpeech();
    setIsLoadingTTS(false);
    setIsSpeaking(false);
    setSentenceSegments([]);
    setCurrentSentenceIndex(-1);

    const docToRemove = mangaDocuments.find(d => d.id === docId);
    if (docToRemove && docToRemove.type === 'pdf' && docToRemove.pdfDataUrl.startsWith('blob:')) {
      URL.revokeObjectURL(docToRemove.pdfDataUrl); // Important: Clean up blob URL
    }
    delete pdfDocCacheRef.current[docId]; // Clear from cache

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
      
      // If the new current document is a PDF, reset its page to 0, otherwise 0 is fine.
      const newCurrentActiveDoc = newDocs[newCurrentDocIndex];
      if (newCurrentActiveDoc && newCurrentActiveDoc.type === 'pdf') {
         setCurrentPdfInternalPageIndex(0);
      } else {
         setCurrentPdfInternalPageIndex(0); // Default for images or if no doc
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
              {isLoadingPdfPage && !currentSubPage?.imageDataUrl && (// Show loader only if no image is yet available for the page
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
                  key={currentSubPage.imageDataUrl}
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
                    (currentDoc?.type === 'pdf' && currentDoc.numPages === 0 && currentDocumentIndex === mangaDocuments.length -1 ) || // handles empty PDF
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
            <CardTitle>Extracted Text / File Info</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-60 overflow-y-auto p-2 border rounded-md bg-muted/50 whitespace-pre-wrap text-sm">
              {isLoadingPdfPage && !currentSubPage?.extractedText ? "Loading page text..." : // Show loading only if text isn't available
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

      {effectiveTextToReadForControls && ( 
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Volume2 className="text-primary" /> Text-to-Speech Controls</CardTitle>
            <CardDescription>Configure and play the text. Sentence highlighting available for local TTS. For PDFs, text is extracted page by page.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            <div className="flex items-center gap-2 flex-wrap">
              {!isSpeaking && !isLoadingTTS && (
                <Button onClick={playSpeech} disabled={!canPlaySelectedText || isLoadingPdfPage || isLoadingDocument}>
                  <Play className="mr-2" /> Play {(typeof window !== 'undefined' && window.getSelection()?.toString().trim()) ? "Selected" : "All"}
                </Button>
              )}
              {isSpeaking && !isLoadingTTS && ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && !window.speechSynthesis.paused &&(
                <Button onClick={pauseSpeech} variant="outline">
                  <Pause className="mr-2" /> Pause
                </Button>
              )}
               {!isSpeaking && !isLoadingTTS && ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.paused && (
                 <Button onClick={resumeSpeech} variant="outline">
                  <Play className="mr-2" /> Resume
                </Button>
               )}
              {(isSpeaking || isLoadingTTS) && (
                <Button onClick={stopSpeech} variant="destructive">
                  <StopCircle className="mr-2" /> Stop
                </Button>
              )}
              {(isLoadingTTS || isLoadingDocument || isLoadingPdfPage) && <Loader2 className="animate-spin" />}
            </div>
             {(typeof window !== 'undefined' && window.getSelection()?.toString().trim()) && <p className="text-sm text-muted-foreground italic">Reading selected text: "{(window.getSelection()?.toString().trim() || "").substring(0,50)}..."</p>}
          </CardContent>
        </Card>
      )}
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

    