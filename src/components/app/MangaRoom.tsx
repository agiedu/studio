
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
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
import { Cloud, Loader2, Play, Pause, Smartphone, BookOpen, ChevronLeft, ChevronRight, Star, Trash2, Image as ImageIcon, UploadCloud, AlertTriangle } from 'lucide-react';
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

  const [activeDocument, setActiveDocument] = useState<MangaDocument | null>(null);
  const [currentPdfInternalPageIndex, setCurrentPdfInternalPageIndex] = useState(0); // 0-indexed
  const [jumpToPageInput, setJumpToPageInput] = useState(''); // 1-indexed for display

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
  const currentFileLocalPathRef = useRef<string | null>(null); // Stores path from local helper service


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

  // Keep a ref to stopSpeech to avoid it being a dependency in useEffect cleanup
  const stopSpeechFnRef = useRef(stopSpeech);
  useEffect(() => {
    stopSpeechFnRef.current = stopSpeech;
  }, [stopSpeech]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
      setTtsSettings(LocalStorage.loadTTSSettings());
    }
    // Save current PDF page index for the active document when it changes
    if (activeDocument && activeDocument.type === 'pdf' && activeDocument.id) {
        LocalStorage.saveCurrentPdfPageIndexForDoc(activeDocument.id, currentPdfInternalPageIndex);
    }
  }, [activeDocument, currentPdfInternalPageIndex]);


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
    if (!doc || doc.type !== 'pdf' || pageNumToRender < 0 || pageNumToRender >= doc.numPages ) {
      setIsLoadingPdfPage(false);
      return;
    }
    setIsLoadingPdfPage(true);
    stopSpeechFnRef.current(true);
    setSentenceSegments([]);
    setCurrentSentenceIndex(-1);

    // Update activeDocument to show "Loading..." for the specific page
    setActiveDocument(prevDoc => {
        if (prevDoc && prevDoc.id === doc.id && prevDoc.type === 'pdf') {
            const updatedProcessedPages = [...prevDoc.processedPages];
            const existingPageData = updatedProcessedPages[pageNumToRender];
            updatedProcessedPages[pageNumToRender] = {
                imageDataUrl: existingPageData?.imageDataUrl || '', // Keep old image if exists
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

      const page: PDFPageProxy = await pdfDocInstance.getPage(pageNumToRender + 1); // PDF.js pages are 1-indexed
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

      // Attempt to extract text directly from PDF
      let textForPage: string;
      const textContent = await page.getTextContent();
      const directText = textContent.items.map(item => ('str' in item ? item.str : '')).join(" ").trim();

      if (directText.length > 1) { // Use direct text if available and substantial
        textForPage = directText;
      } else { // Fallback to OCR if direct text is minimal or empty
        setActiveDocument(prevD => { // Update UI to show OCR is in progress
          if (prevD && prevD.id === doc.id && prevD.type === 'pdf') {
              const updatedPages = [...prevD.processedPages];
              updatedPages[pageNumToRender] = {
                  imageDataUrl: imageDataUrl || updatedPages[pageNumToRender]?.imageDataUrl || '', // Use new or existing image
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
      // Update the specific page in activeDocument with the final data
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
       setActiveDocument(prevD => { // Update UI to show error for the page
          if (prevD && prevD.id === doc.id && prevD.type === 'pdf') {
            const updatedPages = [...prevD.processedPages];
            // Keep existing image if processing failed after image render
            const currentImage = (prevD.processedPages && prevD.processedPages[pageNumToRender]?.imageDataUrl) || '';
            updatedPages[pageNumToRender] = { imageDataUrl: currentImage, extractedText: `Error processing page: ${errorMsg}`};
            return { ...prevD, processedPages: updatedPages };
          }
          return prevD;
        });
    } finally {
      setIsLoadingPdfPage(false);
    }
  }, [toast, stopSpeechFnRef]); // Dependencies for useCallback

  // Effect to render PDF page when document or page index changes
  useEffect(() => {
    if (activeDocument?.type === 'pdf' && activeDocument.numPages > 0 && currentPdfInternalPageIndex >= 0 && currentPdfInternalPageIndex < activeDocument.numPages) {
      setJumpToPageInput((currentPdfInternalPageIndex + 1).toString()); // Update jump input display
      const currentPageData = activeDocument.processedPages[currentPdfInternalPageIndex];
      if (
          ( // Check if page needs processing: no data, or text is undefined/placeholder, and not currently loading
            !currentPageData ||
            !currentPageData.imageDataUrl || // No image yet
            currentPageData.extractedText === undefined || // Text not processed yet
            currentPageData.extractedText?.startsWith("Error:") || // Previous error
            currentPageData.extractedText?.startsWith("Loading PDF page content...") ||
            currentPageData.extractedText?.startsWith("Extracting text using OCR...")
          ) && !isLoadingPdfPage // And not already loading this page
         ) {
         renderAndProcessPdfPage(activeDocument as MangaPdfFile, currentPdfInternalPageIndex);
      }
    } else if (activeDocument?.type === 'image') {
      setJumpToPageInput(''); // Clear jump input for images
    } else if (!activeDocument) {
      setJumpToPageInput(''); // Clear jump input if no document
    }
  }, [activeDocument, currentPdfInternalPageIndex, isLoadingPdfPage, renderAndProcessPdfPage]);


  // Determine current page/text to display and read
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

      // More specific loading/error messages based on page state
      if (isLoadingPdfPage && !currentSubPage?.imageDataUrl && (!currentSubPage?.extractedText || currentSubPage.extractedText === "Loading PDF page content...")) {
         textToRead = "Loading PDF page content...";
      } else if (currentSubPage?.extractedText === "Extracting text using OCR...") {
         textToRead = "Please wait, extracting text using OCR...";
      } else if (currentSubPage?.extractedText === "Loading PDF page content...") {
         textToRead = "Loading PDF page content...";
      } else if (!isLoadingPdfPage && currentSubPage?.imageDataUrl && (currentSubPage.extractedText === undefined || currentSubPage.extractedText === "")) {
         // This case means page was rendered, text extraction (direct or OCR) resulted in empty string
         textToRead = "Page processed. No text extracted or OCR failed. Select text manually if image shows text.";
      } else if (currentSubPage?.extractedText?.startsWith("Error:")) {
         textToRead = currentSubPage.extractedText; // Show the specific error
      }
    } else if (activeDocument.type === 'pdf' && (currentPdfInternalPageIndex < 0 || currentPdfInternalPageIndex >= activeDocument.numPages)){
        textToRead = "Invalid page index."; // Should not happen with guards
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoadingDocument(true);
    stopSpeechFnRef.current(true);
    setSentenceSegments([]);
    setCurrentSentenceIndex(-1);
    // Initial temporary active document state for UI responsiveness
    const tempDocId = `temp-processing-doc-${Date.now()}`;
    setActiveDocument({
        id: tempDocId,
        title: file.name,
        type: file.type.startsWith('image/') ? 'image' : 'pdf',
        ...(file.type.startsWith('image/') ? { imageDataUrl: '', extractedText: "Processing uploaded image..." } : { pdfDataUrl: '', numPages: 0, processedPages: [] })
    } as MangaDocument); // Cast to base type initially
    currentFileLocalPathRef.current = null; // Reset path for new upload


    // Attempt to send to local helper service FIRST
    const formDataForLocalService = new FormData();
    formDataForLocalService.append('file', file);
    let localFilePath: string | undefined;

    try {
        const localUploadResult = await uploadFileToLocalServer(formDataForLocalService);
        if (localUploadResult.success && localUploadResult.filePath) {
            toast({ title: "File Sent to Local Device", description: `${file.name} sent. Path: ${localUploadResult.filePath}` });
            localFilePath = localUploadResult.filePath;
            currentFileLocalPathRef.current = localFilePath; // Store for favorites
        } else {
            toast({ variant: "destructive", title: "Local Save Failed", description: (localUploadResult.message || "Could not save to local device.") + " File will only be available for this session and will be lost on refresh if local saving fails." });
            currentFileLocalPathRef.current = file.name; // Fallback for favorites if local save fails
             console.warn("[MangaRoom] Local save failed for", file.name, ":", localUploadResult.message);
        }
    } catch (uploadError: any) {
        toast({ variant: "destructive", title: "Local Save Service Error", description: (uploadError.message || "Could not send file to local service.") + " File will only be available for this session and will be lost on refresh if local saving fails." });
        currentFileLocalPathRef.current = file.name; // Fallback
        console.error("[MangaRoom] Error sending to local service for", file.name, ":", uploadError);
    }

    // Process file for current session display
    const sessionDocId = `session-${file.type.startsWith('image/') ? 'image' : 'pdf'}-${Date.now()}`;

    try {
      if (file.type.startsWith('image/')) {
        const imageDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Update UI to show OCR is in progress for the image
        setActiveDocument({
            id: sessionDocId,
            title: file.name,
            type: 'image',
            imageDataUrl: imageDataUrl,
            extractedText: "Performing OCR...", // Initial OCR state
        });

        let ocrText = "OCR pending..."; // Default if OCR somehow fails before starting
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
        
         // Update document with final OCR text
         setActiveDocument(prev => (prev?.id === sessionDocId ? {
            ...(prev as MangaImageFile), // Ensure correct type
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
        
        const initialPageIndex = LocalStorage.loadCurrentPdfPageIndexForDoc(sessionDocId) || 0; // Load saved page or default to 0
        
        // Set up the PDF document structure
        setActiveDocument({
            id: sessionDocId,
            title: file.name,
            type: 'pdf',
            pdfDataUrl: pdfDataUrlFull, // Store for re-rendering if needed
            numPages: pdfInstance.numPages,
            // Initialize processedPages with placeholders or empty objects
            processedPages: new Array(pdfInstance.numPages).fill(null).map(() => ({ imageDataUrl: '', extractedText: undefined })),
        });
        setCurrentPdfInternalPageIndex(initialPageIndex); // Set initial page
        setJumpToPageInput((initialPageIndex + 1).toString()); // Update jump input display
        pdfDocCacheRef.current = {}; // Clear cache for new PDF
        pdfDocCacheRef.current[sessionDocId] = pdfInstance; // Cache the new PDF instance for rendering pages
        // renderAndProcessPdfPage will be triggered by useEffect for initialPageIndex
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
        fileInputRef.current.value = ''; // Reset file input after processing
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
    stopSpeechFnRef.current(false); // Stop previous speech but don't fully reset UI yet
    await new Promise(resolve => setTimeout(resolve, 150)); // Short delay for UI/state to settle

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
      setCurrentSentenceIndex(0); // Start highlighting from the first segment

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
        if (newIdx !== -1 && utteranceRef.current === utterance) { // Check if still the current utterance
            setCurrentSentenceIndex(newIdx);
        }
      };

      utterance.onend = () => {
        if (utteranceRef.current === utterance) stopSpeechFnRef.current(true); // Only stop if it's the current one
      };
      utterance.onerror = (event) => {
         if (utteranceRef.current === utterance) { // Only handle error for current utterance
            toast({ variant: "destructive", title: "TTS Error", description: event.error || "Failed to play speech." });
            stopSpeechFnRef.current(true);
        }
      };
      utteranceRef.current = utterance; // Set the current utterance
      window.speechSynthesis.speak(utterance);
      setIsLoadingTTS(false); // Local TTS starts speaking almost immediately

    } else { // Cloud TTS
      setSentenceSegments([]); // Cloud TTS doesn't support sentence highlighting directly from this component
      setCurrentSentenceIndex(-1);
      try {
        const cloudResult = await getCloudSpeech(effectiveTextToRead, ttsSettings.language);
        if ('audioUrl' in cloudResult && audioPlayerRef.current) {
            audioPlayerRef.current.src = cloudResult.audioUrl;
            await audioPlayerRef.current.play();
            // setIsLoadingTTS(false) is handled by 'playing' event of audio player for cloud
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
    if (isSpeaking && !isPausedState) { // Can only pause if speaking and not already paused
        if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
          window.speechSynthesis.pause();
          setIsPausedState(true);
        } else if (audioPlayerRef.current && !audioPlayerRef.current.paused) { // For cloud
          audioPlayerRef.current.pause();
          setIsPausedState(true);
        }
    }
  };

  const resumeSpeech = () => {
    if (isSpeaking && isPausedState) { // Can only resume if speaking and paused
        if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
            if (window.speechSynthesis.paused) { // Check if browser is actually paused
                window.speechSynthesis.resume();
                setIsPausedState(false);
                // Workaround for some browser issues where speech doesn't actually resume
                setTimeout(() => {
                    if (utteranceRef.current && isSpeaking && !isPausedState && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
                        // If still not speaking and not pending after resume, something went wrong
                        stopSpeechFnRef.current(true); 
                    }
                }, 100);
            } else { 
                 // If not paused by browser, but our state says it is, sync by stopping
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


  // Effect for audio player setup and cleanup (mostly for Cloud TTS)
  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;

    const handleAudioEnded = () => stopSpeechFnRef.current(true);
    const handleAudioPlaying = () => {
        if (ttsSettings.type === 'cloud' && isSpeaking) { // Only for cloud
            setIsLoadingTTS(false); // Cloud TTS is loaded and playing
            setIsPausedState(false); // Ensure not marked as paused if it starts playing
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
      if (audioPlayerRef.current === player) audioPlayerRef.current = null; // Clear ref if it's this player
    };
  }, [ttsSettings.type, isSpeaking, toast]); // Re-run if TTS type or speaking state changes


  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    stopSpeechFnRef.current(true); // Stop speech when settings change
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
             setJumpToPageInput(resetValue || '1'); // Revert to current valid page or '1'
        }
        // If valid, currentPdfInternalPageIndex is already set by onChange, no need to set here again.
    } else {
      setJumpToPageInput(resetValue); // No active PDF, clear or reset
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
     if (fileInputRef.current) { // Reset file input
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
        sourceDocumentId: currentFileLocalPathRef.current || currentDocForFavorite.title || "unknown_source_read2", // Use local path if available
        sourceDocumentName: currentDocForFavorite.title || "Untitled Document (Read2)",
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
                    !isLoadingPdfPage && // Not loading PDF page visuals/text
                    !isLoadingDocument && // Not loading the initial document
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
            The file will also be sent to your **local helper service** for persistent storage on your device (if the service is running and accessible).
            **If the local helper service is not running or fails, the document will be lost on page refresh.**
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
                  ): activeDocument.type === 'image' && !currentSubPage?.imageDataUrl && !isLoadingDocument ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                        <ImageIcon className="w-16 h-16 text-destructive mb-4" />
                        <p>Image data is missing or failed to load for display.</p>
                    </div>
                  ) : (
                     !isLoadingDocument && !activeDocument &&
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                      <ImageIcon className="w-16 h-16 text-primary mb-4" />
                      <p>No document loaded in this session. Please upload a document above to begin.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
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
          
          {isLoadingDocument && activeDocument && <p className="text-sm text-muted-foreground text-center">Processing file for session...</p>}

          {!activeDocument && !isLoadingDocument &&(
             <Card className="text-center">
              <CardHeader>
                <CardTitle>No File Loaded for This Session</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-muted-foreground">Upload a document above to begin reading in this session. The file will also be attempted to be sent to your local helper service for persistent storage.</p>
                <BookOpen className="mx-auto my-3 h-12 w-12 text-muted-foreground" />
                 <div className="border border-amber-500 bg-amber-50 p-3 rounded-md text-amber-700 text-xs">
                    <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-5 w-5 text-amber-600" /> Important Note on Persistence:
                    </div>
                    <p className="mt-1">
                        Documents uploaded here are primarily for the current session. They are also sent to your local helper service (if it's running at `http://localhost:3001/upload`).
                        **If the local helper service is not running or the upload to it fails, the document will be lost when you refresh this page or close the browser.**
                        To ensure documents are saved persistently on your device, please verify your local helper service is active and correctly configured.
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
