
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
import { Cloud, FileText, Loader2, Play, Pause, Smartphone, UploadCloud, XCircle, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
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
    throw new Error("Invalid Base64 string for PDF data. The file might be corrupted or not a valid PDF.");
  }
}

export function MangaRoom() {
  const { toast } = useToast();
  const [mangaDocuments, setMangaDocuments] = useState<MangaDocument[]>([]);
  const [currentDocumentIndex, setCurrentDocumentIndex] = useState(0);
  const [currentPdfInternalPageIndex, setCurrentPdfInternalPageIndex] = useState(0); 
  const [jumpToPageInput, setJumpToPageInput] = useState('');


  const [ttsSettings, setTtsSettings] = useState<TTSSettings>(LocalStorage.defaultTTSSettings);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false); 
  const [isLoadingPdfPage, setIsLoadingPdfPage] = useState(false); 
  const [isLoadingTTS, setIsLoadingTTS] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);
  
  const [sentenceSegments, setSentenceSegments] = useState<string[]>([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number>(-1);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const pdfDocCacheRef = useRef<Record<string, PDFDocumentProxy>>({}); 

  useEffect(() => {
    if (typeof window !== 'undefined') {
      GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
    }
  }, []);

  useEffect(() => {
    const loadedDocs = LocalStorage.loadDocuments();
    setMangaDocuments(loadedDocs);
    const loadedDocIndex = LocalStorage.loadCurrentDocumentIndex();
    setCurrentDocumentIndex(loadedDocIndex < loadedDocs.length ? loadedDocIndex : 0);
    
    const loadedPdfPageIndex = LocalStorage.loadCurrentPdfPageIndex();
    const activeDoc = loadedDocs[loadedDocIndex < loadedDocs.length ? loadedDocIndex : 0];
    if (activeDoc?.type === 'pdf' && loadedPdfPageIndex < activeDoc.numPages) {
      setCurrentPdfInternalPageIndex(loadedPdfPageIndex);
      setJumpToPageInput((loadedPdfPageIndex + 1).toString());
    } else {
      setCurrentPdfInternalPageIndex(0);
      if (activeDoc?.type === 'pdf') setJumpToPageInput('1');
      else setJumpToPageInput('');
    }
    
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
            audioPlayerRef.current.src = ""; // Clear src to ensure it stops loading/playing
         } catch (e) {
            // console.warn("Could not set audio currentTime on stop", e);
         }
      }
    }
    if (utteranceRef.current) {
      utteranceRef.current.onend = null; 
      utteranceRef.current.onboundary = null;
      utteranceRef.current = null;
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

  const renderAndProcessPdfPage = useCallback(async (docId: string, pageNumToRender: number) => { 
    setIsLoadingPdfPage(true);
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
       setJumpToPageInput((pageNumToRender + 1).toString());
       return;
    }
    
    try {
      let pdfDocInstance = pdfDocCacheRef.current[pdfDocToProcess.id];
      if (!pdfDocInstance) {
        if (!pdfDocToProcess.pdfDataUrl || !pdfDocToProcess.pdfDataUrl.startsWith('data:application/pdf;base64,')) {
            console.error("Invalid or missing pdfDataUrl for document:", pdfDocToProcess.id, pdfDocToProcess.pdfDataUrl);
            toast({ variant: "destructive", title: "PDF Data Error", description: `Corrupted or outdated PDF data for ${pdfDocToProcess.title}. Please re-upload the PDF.` });
            setMangaDocuments(prevDocs => prevDocs.map(d => {
              if (d.id === pdfDocToProcess.id && d.type === 'pdf') {
                const updatedProcessedPages = [...d.processedPages];
                updatedProcessedPages[pageNumToRender] = { imageDataUrl: '', extractedText: 'Error: Corrupted PDF data. Please re-upload.'};
                return { ...d, processedPages: updatedProcessedPages };
              }
              return d;
            }));
            setIsLoadingPdfPage(false);
            return;
        }
        const base64Data = pdfDocToProcess.pdfDataUrl.split(',')[1];
        if (!base64Data) {
            console.error("Empty Base64 data for PDF:", pdfDocToProcess.id);
            toast({ variant: "destructive", title: "PDF Data Error", description: `Empty PDF data for ${pdfDocToProcess.title}. Try re-uploading.` });
             setMangaDocuments(prevDocs => prevDocs.map(d => {
              if (d.id === pdfDocToProcess.id && d.type === 'pdf') {
                const updatedProcessedPages = [...d.processedPages];
                updatedProcessedPages[pageNumToRender] = { imageDataUrl: '', extractedText: 'Error: Empty PDF data. Please re-upload.'};
                return { ...d, processedPages: updatedProcessedPages };
              }
              return d;
            }));
            setIsLoadingPdfPage(false);
            return;
        }
        const pdfBytes = base64ToUint8Array(base64Data);
        const loadingTask = getDocument({data: pdfBytes});
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
        setJumpToPageInput((pageNumToRender + 1).toString());
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
            updatedProcessedPages[pageNumToRender] = { imageDataUrl: '', extractedText: `Error processing page: ${error.message || 'Unknown error'}`};
            return { ...doc, processedPages: updatedProcessedPages };
          }
          return doc;
        }));
    } finally {
      setIsLoadingPdfPage(false);
    }
  }, [mangaDocuments, toast]); // Removed pdfDocCacheRef from dependencies as it's a ref

  useEffect(() => {
    const currentDoc = mangaDocuments[currentDocumentIndex];
    if (currentDoc?.type === 'pdf' && currentDoc.numPages > 0 && currentPdfInternalPageIndex < currentDoc.numPages) {
      setJumpToPageInput((currentPdfInternalPageIndex + 1).toString());
      if (!currentDoc.processedPages[currentPdfInternalPageIndex]?.imageDataUrl &&
          !currentDoc.processedPages[currentPdfInternalPageIndex]?.extractedText &&
          !isLoadingPdfPage
         ) {
         renderAndProcessPdfPage(currentDoc.id, currentPdfInternalPageIndex);
      }
    } else if (currentDoc?.type === 'image') {
      setJumpToPageInput(''); // No page input for images
    }
  // renderAndProcessPdfPage is memoized, mangaDocuments triggers reload when content changes
  }, [currentDocumentIndex, currentPdfInternalPageIndex, mangaDocuments, renderAndProcessPdfPage, isLoadingPdfPage]);


  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    stopSpeech();
    setIsLoadingDocument(true);
    const commonPageId = Date.now().toString();
    const fileInputTarget = event.target; // Store target for reset

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
                setCurrentPdfInternalPageIndex(0); // Reset for new doc
                return newDocs;
            });
            toast({ title: "Image OCR Success", description: "Text extracted." });
        } catch (ocrError: any) {
            toast({ variant: "destructive", title: "OCR Error", description: ocrError.message || "Failed to extract text." });
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
        const pdfBase64DataUrl = e.target?.result as string;
         if (!pdfBase64DataUrl || !pdfBase64DataUrl.startsWith('data:application/pdf;base64,')) {
            toast({ variant: "destructive", title: "Upload Error", description: "Invalid or corrupted PDF file processed." });
            setIsLoadingDocument(false);
            if (fileInputTarget) fileInputTarget.value = '';
            return;
        }

        try {
          const base64DataForNumPagesCheck = pdfBase64DataUrl.split(',')[1];
          if (!base64DataForNumPagesCheck) {
              console.error("Empty Base64 data during PDF upload for numPages check:", file.name);
              toast({ variant: "destructive", title: "PDF Upload Error", description: `Could not extract data from PDF ${file.name}.` });
              setIsLoadingDocument(false);
              if (fileInputTarget) fileInputTarget.value = '';
              return;
          }
          const pdfBytes = base64ToUint8Array(base64DataForNumPagesCheck);
          const loadingTask = getDocument({data: pdfBytes});
          const pdf = await loadingTask.promise;
          
          // Don't store the full PDF instance in cache yet, do it on first page render
          // pdfDocCacheRef.current[commonPageId] = pdf; 

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
            setCurrentPdfInternalPageIndex(0); // Reset for new doc
            return newDocs;
          });
          // No need to toast "Processing first page..." here, useEffect will handle it
          toast({ title: "PDF Uploaded", description: `${file.name} (${pdf.numPages} pages).` });

        } catch (pdfLoadError: any) {
          console.error("Error loading PDF:", pdfLoadError);
          toast({ variant: "destructive", title: "PDF Load Error", description: pdfLoadError.message || "Failed to load PDF. The file might be corrupted or not a standard PDF." });
        } finally {
          setIsLoadingDocument(false);
          if (fileInputTarget) fileInputTarget.value = ''; // Reset file input
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
         if (!currentSubPage || (currentSubPage && !currentSubPage.extractedText && currentSubPage.imageDataUrl && !currentSubPage.imageDataUrl.includes("Error"))) { 
            textToRead = "Processing PDF page, please wait. You can also manually select text from this message to read aloud.";
         } else if (currentSubPage && currentSubPage.extractedText && currentSubPage.extractedText.startsWith("Error:")) {
            textToRead = currentSubPage.extractedText;
         }
         else {
            textToRead = "No text extracted for this page yet. Select text manually if available, or wait if processing.";
         }
      } else if (isLoadingPdfPage) {
         textToRead = "Loading PDF page content...";
      }
    }
  }

  const playSpeech = async () => {
    // This function now initiates speech or resumes if paused (for local)
    // For cloud, it will always replay from start if paused/stopped
    setIsLoadingTTS(true); 
    
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const effectiveTextToRead = selectedText || textToRead;

    if (!effectiveTextToRead || isLoadingPdfPage) {
      toast({ variant: "destructive", title: "No Text", description: "No text available to read or PDF page is loading." });
      setIsLoadingTTS(false);
      setIsSpeaking(false); // Ensure isSpeaking is false if nothing to play
      return;
    }

    // If currently speaking (and not paused for local), or if cloud TTS is active, calling play again implies re-starting.
    // For local TTS, if it's just paused, resumeSpeech will handle it.
    if (isSpeaking && ttsSettings.type === 'cloud') {
        stopSpeech(); // Stop current cloud playback before starting new
    } else if (isSpeaking && ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && !window.speechSynthesis.paused) {
        stopSpeech(); // Stop currently playing local TTS
    }


    if (ttsSettings.type === 'local') {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
        setIsLoadingTTS(false);
        setIsSpeaking(false);
        return;
      }
      // If paused, resume
      if (window.speechSynthesis.paused && utteranceRef.current) {
        window.speechSynthesis.resume();
        setIsSpeaking(true);
        setIsLoadingTTS(false);
        return;
      }

      // If not paused, or no utterance, start new
      stopSpeech(); // Clear any previous utterance state
      setIsSpeaking(true);


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
        // Check newIdx against currentSentenceIndex from state to avoid flicker if boundary event is too frequent
        setCurrentSentenceIndex(prevIdx => newIdx !== -1 && newIdx !== prevIdx ? newIdx : prevIdx);
      };
      
      utterance.onend = () => {
        setIsSpeaking(false);
        setIsLoadingTTS(false);
        setCurrentSentenceIndex(-1); 
        utteranceRef.current = null; // Clear ref on end
      };
      utterance.onerror = (event) => {
        toast({ variant: "destructive", title: "TTS Error", description: event.error || "Failed to play speech." });
        setIsSpeaking(false);
        setIsLoadingTTS(false);
        setCurrentSentenceIndex(-1);
        setSentenceSegments([]);
        utteranceRef.current = null; // Clear ref on error
      };
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
      // setIsLoadingTTS(false) will be handled by onend or playing for local

    } else { // Cloud TTS
      stopSpeech(); // Ensure previous cloud TTS is stopped
      setIsSpeaking(true);
      setSentenceSegments([]); 
      setCurrentSentenceIndex(-1);
      try {
        const cloudResult = await getCloudSpeech(effectiveTextToRead, ttsSettings.language);
        if ('audioUrl' in cloudResult && audioPlayerRef.current) {
            audioPlayerRef.current.src = cloudResult.audioUrl;
            await audioPlayerRef.current.play();
            // setIsLoadingTTS will be handled by audio player events
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
      // isSpeaking remains true, but browser indicates paused
    } else if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      // isSpeaking remains true, but audio player is paused
    }
  };
  
  // resumeSpeech is now effectively handled by playSpeech checking for paused state
  
  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;

    const handleAudioEnded = () => {
      setIsSpeaking(false);
      setIsLoadingTTS(false);
    };
    const handleAudioPlaying = () => { // Renamed from canplaythrough
        if (ttsSettings.type === 'cloud' && isSpeaking) { // Only set loading false if it was meant to be speaking
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
        
    player.addEventListener('ended', handleAudioEnded);
    player.addEventListener('playing', handleAudioPlaying); // Changed from canplaythrough
    player.addEventListener('error', handleAudioError);

    return () => {
      player.removeEventListener('ended', handleAudioEnded);
      player.removeEventListener('playing', handleAudioPlaying);
      player.removeEventListener('error', handleAudioError);
      
      if (player.src && !player.paused) { 
        player.pause();
      }
      player.src = ""; // Ensure src is cleared
      if (audioPlayerRef.current === player) { 
        audioPlayerRef.current = null;
      }
    };
  }, [ttsSettings.type, isSpeaking, toast]); // isSpeaking dependency might be tricky here, re-evaluate if needed.


  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    stopSpeech(); 
    setTtsSettings(prev => ({ ...prev, [key]: value }));
    if (key === 'type') { 
      setSentenceSegments([]);
      setCurrentSentenceIndex(-1);
    }
  };

  const navigatePdfPage = (direction: 'next' | 'prev') => {
    stopSpeech();
    const doc = mangaDocuments[currentDocumentIndex];
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
      // setJumpToPageInput((newPdfPage + 1).toString()); // useEffect will handle this
    }
  };

  const navigateDocument = (direction: 'next' | 'prev') => {
    stopSpeech();
    let newDocIndex = currentDocumentIndex;
    if (direction === 'next' && currentDocumentIndex < mangaDocuments.length - 1) {
      newDocIndex = currentDocumentIndex + 1;
    } else if (direction === 'prev' && currentDocumentIndex > 0) {
      newDocIndex = currentDocumentIndex - 1;
    }

    if (newDocIndex !== currentDocumentIndex) {
      setCurrentDocumentIndex(newDocIndex);
      setCurrentPdfInternalPageIndex(0); 
      // const newDoc = mangaDocuments[newDocIndex]; // useEffect will handle jumpToPageInput
      // if (newDoc?.type === 'pdf') {
      //   setJumpToPageInput('1');
      // } else {
      //   setJumpToPageInput('');
      // }
    }
  };

  const handleJumpToPage = () => {
    const doc = mangaDocuments[currentDocumentIndex];
    if (!doc || doc.type !== 'pdf') return;
    
    const pageNum = parseInt(jumpToPageInput, 10) -1;
    if (!isNaN(pageNum) && pageNum >= 0 && pageNum < doc.numPages && pageNum !== currentPdfInternalPageIndex) {
      stopSpeech();
      setCurrentPdfInternalPageIndex(pageNum);
    } else {
      setJumpToPageInput((currentPdfInternalPageIndex + 1).toString());
    }
  };
  
  const removeDocument = (docId: string) => {
    stopSpeech();
    delete pdfDocCacheRef.current[docId]; 

    const oldIndex = mangaDocuments.findIndex(d => d.id === docId);
    const newDocs = mangaDocuments.filter(d => d.id !== docId);
    setMangaDocuments(newDocs); // This will trigger save via useEffect

    if (newDocs.length === 0) {
      setCurrentDocumentIndex(0);
      setCurrentPdfInternalPageIndex(0);
      // setJumpToPageInput(''); // Handled by useEffect
    } else {
      let newCurrentDocIndex = currentDocumentIndex;
      if (oldIndex < currentDocumentIndex) {
        newCurrentDocIndex = currentDocumentIndex - 1;
      } else if (oldIndex === currentDocumentIndex) {
        // If deleting the current doc, try to stay at the same index if possible, else move back
        newCurrentDocIndex = Math.min(oldIndex, newDocs.length - 1);
        newCurrentDocIndex = Math.max(0, newCurrentDocIndex);
      }
      
      if (newCurrentDocIndex >= newDocs.length) { // Boundary check
         newCurrentDocIndex = Math.max(0, newDocs.length - 1);
      }
      setCurrentDocumentIndex(newCurrentDocIndex);
      
      // Reset PDF page for the new current document
      const newActiveDoc = newDocs[newCurrentDocIndex];
      if (newActiveDoc && newActiveDoc.type === 'pdf') {
         setCurrentPdfInternalPageIndex(0); // Always reset to first page of new/remaining doc
         // setJumpToPageInput('1'); // Handled by useEffect
      } else {
         setCurrentPdfInternalPageIndex(0); 
         // setJumpToPageInput(''); // Handled by useEffect
      }
    }
  };

  const selectDocument = (docId: string) => {
    const docIndex = mangaDocuments.findIndex(d => d.id === docId);
    if (docIndex !== -1 && docIndex !== currentDocumentIndex) {
      stopSpeech();
      setCurrentDocumentIndex(docIndex);
      setCurrentPdfInternalPageIndex(0); // Reset PDF page to first
      // const newDoc = mangaDocuments[docIndex]; // useEffect handles jump input
      // if (newDoc?.type === 'pdf') {
      //   setJumpToPageInput('1');
      // } else {
      //   setJumpToPageInput('');
      // }
    }
  };

  const canPlaySelectedText = !!(typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '') || !!textToRead;
  const effectiveTextToReadForControls = (typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '') || textToRead;

  const getPlayButtonState = () => {
    if (isLoadingTTS) return { icon: <Loader2 className="mr-1 h-3 w-3 animate-spin" />, text: "Loading...", disabled: true, action: () => {} };
    if (isSpeaking) {
        if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis.paused) {
            return { icon: <Play className="mr-1 h-3 w-3" />, text: "Resume", action: playSpeech, variant: "outline" as "outline" | "default" | "destructive"};
        }
        if (ttsSettings.type === 'cloud' && audioPlayerRef.current?.paused && audioPlayerRef.current.src) {
             return { icon: <Play className="mr-1 h-3 w-3" />, text: "Resume", action: () => audioPlayerRef.current?.play(), variant: "outline" as "outline" | "default" | "destructive"};
        }
        return { icon: <Pause className="mr-1 h-3 w-3" />, text: "Pause", action: pauseSpeech, variant: "outline" as "outline" | "default" | "destructive"};
    }
    return { icon: <Play className="mr-1 h-3 w-3" />, text: (typeof window !== 'undefined' && window.getSelection()?.toString().trim()) ? "Play Selected" : "Play All", action: playSpeech, disabled: !canPlaySelectedText || isLoadingPdfPage || isLoadingDocument, variant: "default" as "outline" | "default" | "destructive"};
  };

  const playButtonState = getPlayButtonState();

  return (
    <div className="container mx-auto p-4 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Upload Manga Page or PDF</CardTitle>
          <CardDescription>Upload an image or a PDF document. PDF pages will be processed one by one.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="manga-upload">Manga File</Label>
            <Input id="manga-upload" type="file" accept="image/*,application/pdf" onChange={handleFileUpload} disabled={isLoadingDocument || isLoadingPdfPage} />
          </div>
          {(isLoadingDocument) && <Progress value={undefined} className="w-full mt-2" />}
        </CardContent>
      </Card>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-grow space-y-6">
          {mangaDocuments.length > 0 && currentDoc && (
            <Card>
               <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Viewing: {currentDoc.title || `Document ${currentDocumentIndex + 1}`}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative aspect-[2/3] w-full mx-auto bg-muted rounded-md overflow-hidden shadow-lg">
                  {(isLoadingPdfPage && !currentSubPage?.imageDataUrl) && (
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
                      key={`${currentDoc.id}-${currentPdfInternalPageIndex}-${currentSubPage.imageDataUrl.substring(0,20)}`} 
                    />
                  ) : currentDoc.type === 'pdf' && !isLoadingPdfPage ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                      <BookOpen className="w-16 h-16 text-primary mb-4" />
                      <p className="font-semibold">{currentDoc.title || 'PDF Document'}</p>
                      <p className="text-sm text-muted-foreground">
                        { currentDoc.numPages > 0 ? `Page ${currentPdfInternalPageIndex + 1} of ${currentDoc.numPages}. Waiting to process...` : "Empty PDF or error loading."}
                      </p>
                       {isLoadingPdfPage && <Loader2 className="h-6 w-6 animate-spin text-primary mt-2" />}
                       {!isLoadingPdfPage && currentDoc.numPages > 0 && !currentSubPage?.imageDataUrl &&
                         <Button onClick={() => renderAndProcessPdfPage(currentDoc.id, currentPdfInternalPageIndex)} className="mt-2" size="sm">Process This Page</Button>
                       }
                      <p className="text-xs text-muted-foreground mt-2">If this takes too long, the page might be complex or an error occurred.</p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-center p-4">
                      <FileText className="w-16 h-16 text-primary mb-4" />
                      <p>No content to display for this page.</p>
                    </div>
                  )}
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

        <div className="lg:w-36 lg:sticky lg:top-16 h-fit">
          <Card>
            <CardHeader className="p-4">
              <Label htmlFor="document-select" className="mb-1 text-sm font-medium">Documents</Label>
              {mangaDocuments.length > 0 ? (
                <Select 
                  onValueChange={(docId) => selectDocument(docId)} 
                  value={currentDoc?.id || ""}
                  disabled={isLoadingDocument || isLoadingPdfPage || isLoadingTTS || isSpeaking}
                >
                  <SelectTrigger id="document-select">
                    <SelectValue placeholder="Select a document" />
                  </SelectTrigger>
                  <SelectContent>
                    {mangaDocuments.map(doc => (
                      <SelectItem key={doc.id} value={doc.id}>
                        <div className="flex justify-between items-center w-full text-xs">
                          <span className="truncate " title={doc.title}>{doc.title}</span>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              removeDocument(doc.id); 
                            }} 
                            className="h-5 w-5 ml-1 flex-shrink-0"
                            aria-label={`Remove ${doc.title}`}
                            disabled={isLoadingDocument || isLoadingPdfPage || isLoadingTTS || isSpeaking}
                          >
                            <XCircle className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground">No documents uploaded.</p>
              )}
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {currentDoc?.type === 'pdf' && currentDoc.numPages > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="pdf-page-jump" className="text-sm">Page (PDF)</Label>
                  <div className="flex items-center gap-1">
                    <Button 
                      onClick={() => navigatePdfPage('prev')} 
                      disabled={currentPdfInternalPageIndex === 0 || isLoadingPdfPage || isLoadingTTS || isSpeaking}
                      size="sm"
                      variant="outline"
                      className="px-2"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Input 
                      id="pdf-page-jump"
                      type="text" 
                      inputMode="numeric"
                      className="h-8 w-12 text-center text-sm px-1"
                      value={jumpToPageInput}
                      onChange={(e) => setJumpToPageInput(e.target.value)}
                      onBlur={handleJumpToPage}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleJumpToPage(); }}
                      disabled={isLoadingPdfPage || isLoadingTTS || isSpeaking}
                    />
                     <Button 
                      onClick={() => navigatePdfPage('next')} 
                      disabled={currentPdfInternalPageIndex >= currentDoc.numPages - 1 || isLoadingPdfPage || isLoadingTTS || isSpeaking}
                      size="sm"
                      variant="outline"
                      className="px-2"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">of {currentDoc.numPages}</p>
                </div>
              )}

              {mangaDocuments.length > 1 && (
                 <div className="space-y-2">
                  <Label className="text-sm">Document Navigation</Label>
                   <div className="flex items-center gap-2">
                      <Button 
                        onClick={() => navigateDocument('prev')} 
                        disabled={currentDocumentIndex === 0 || isLoadingTTS || isSpeaking || isLoadingDocument || isLoadingPdfPage}
                        size="sm"
                        variant="outline"
                      >
                        <ChevronLeft className="mr-1 h-4 w-4" /> Prev
                      </Button>
                      <Button 
                        onClick={() => navigateDocument('next')} 
                        disabled={currentDocumentIndex === mangaDocuments.length - 1 || isLoadingTTS || isSpeaking || isLoadingDocument || isLoadingPdfPage}
                        size="sm"
                        variant="outline"
                      >
                        Next <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    </div>
                 </div>
              )}
              
              {effectiveTextToReadForControls && (
                <>
                  <hr className="my-3 border-border" />
                  <Label className="text-sm block mb-1">TTS Settings</Label>
                  <div className="flex flex-col gap-3">
                    <div>
                      <Label htmlFor="tts-type" className="text-xs">Engine</Label>
                      <Select value={ttsSettings.type} onValueChange={(v) => handleSettingChange('type', v as 'local' | 'cloud')} disabled={isSpeaking || isLoadingTTS}>
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
                          disabled={isSpeaking || isLoadingTTS}
                          className="h-8 text-xs"
                        />
                    </div>
                  </div>

                  {ttsSettings.type === 'local' && availableVoices.length > 0 && (
                    <div>
                      <Label htmlFor="tts-voice" className="text-xs">Voice (Local)</Label>
                      <Select value={ttsSettings.voiceURI} onValueChange={(v) => handleSettingChange('voiceURI', v)} disabled={isSpeaking || isLoadingTTS}>
                        <SelectTrigger id="tts-voice" className="h-8 text-xs">
                          <SelectValue placeholder="Select voice" />
                        </SelectTrigger>
                        <SelectContent className="max-h-48">
                          {availableVoices.filter(v => v.lang.startsWith(ttsSettings.language.split('-')[0])).map(voice => (
                            <SelectItem key={voice.voiceURI || voice.name} value={voice.voiceURI} className="text-xs">
                              {voice.name} ({voice.lang}) {voice.default ? "[Def]" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  
                  <div className="space-y-1">
                    <Label htmlFor="tts-rate" className="text-xs">Rate: {ttsSettings.rate.toFixed(1)}</Label>
                    <Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={isSpeaking || isLoadingTTS}/>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tts-pitch" className="text-xs">Pitch: {ttsSettings.pitch.toFixed(1)}</Label>
                    <Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={isSpeaking || isLoadingTTS}/>
                  </div>

                  <div className="flex flex-col items-start gap-2 pt-2">
                    <Button 
                        onClick={playButtonState.action} 
                        disabled={playButtonState.disabled} 
                        variant={playButtonState.variant}
                        className="w-full h-8 text-xs"
                    >
                        {playButtonState.icon} {playButtonState.text}
                    </Button>
                    {isSpeaking && (
                        <Button onClick={stopSpeech} variant="destructive" className="w-full h-8 text-xs">
                            <XCircle className="mr-1 h-3 w-3" /> Stop All
                        </Button>
                    )}
                  </div>
                  {(typeof window !== 'undefined' && window.getSelection()?.toString().trim()) && <p className="text-xs text-muted-foreground italic">Reading selection: "{(window.getSelection()?.toString().trim() || "").substring(0,30)}..."</p>}
                </>
              )}
            </CardContent>
          </Card>
        </div>
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

