
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { getDocument, GlobalWorkerOptions, version as pdfjsVersion } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Play, Pause, Smartphone, Cloud as CloudIcon, AlertTriangle, Info, Star } from 'lucide-react';
import { getCloudSpeech } from '@/app/actions';
import * as LocalStorage from '@/lib/localStorageService';
import type { StoredDocument, TTSVoice, FavoriteItem } from '@/types';

interface ReaderTTSSettings {
  engine: 'local' | 'cloud';
  language: string;
  rate: number;
  pitch: number;
  voiceURI?: string;
}

// Helper to convert base64 to Uint8Array
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
    console.error("Failed to decode Base64 string for PDF processing:", e);
    throw new Error("Invalid Base64 data for PDF.");
  }
}


export default function ReaderPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const docId = searchParams.get('docId');

  const [loadedDocument, setLoadedDocument] = useState<StoredDocument | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<string>("");
  const [isLoadingDocument, setIsLoadingDocument] = useState<boolean>(false);
  const [isLoadingTTS, setIsLoadingTTS] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  const [ttsSettings, setTtsSettings] = useState<ReaderTTSSettings>({
    engine: 'local',
    language: 'en-US',
    rate: 1,
    pitch: 1,
    voiceURI: undefined,
  });
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
      setTtsSettings(LocalStorage.loadTTSSettings());
    }
  }, []);

  useEffect(() => {
    if (docId) {
      setIsLoadingDocument(true);
      setExtractedText("");
      setFileName(null);
      setLoadedDocument(null);
      stopSpeech(true);

      const doc = LocalStorage.getStoredDocumentById(docId);
      if (doc) {
        setLoadedDocument(doc);
        setFileName(doc.name);
        if (doc.type === 'txt') {
          setExtractedText(doc.textContent);
          setIsLoadingDocument(false);
        } else if (doc.type === 'pdf') {
          processPdfContent(doc.pdfBase64);
        }
      } else {
        toast({ variant: "destructive", title: "Document Not Found", description: "The requested document could not be found in your library." });
        setExtractedText("Error: Document not found.");
        setIsLoadingDocument(false);
      }
    } else {
      setExtractedText("No document loaded. Please select a document from your library.");
      setFileName(null);
      setLoadedDocument(null);
      setIsLoadingDocument(false);
    }
  }, [docId, toast]);


  const processPdfContent = async (pdfBase64: string) => {
    try {
      const pdfData = base64ToUint8Array(pdfBase64);
      const pdf = await getDocument({ data: pdfData }).promise;
      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => ('str' in item ? item.str : '')).join(" ") + "\n\n";
      }
      setExtractedText(fullText.trim() || "No text could be extracted from this PDF.");
    } catch (error: any) {
      console.error("PDF Processing Error:", error);
      toast({ variant: "destructive", title: "PDF Processing Error", description: error.message || "Failed to extract text from PDF." });
      setExtractedText("Error processing PDF. It might be image-based, corrupted, or use a format pdf.js cannot read.");
    } finally {
      setIsLoadingDocument(false);
    }
  };


  const stopSpeech = useCallback((resetUIState = true) => {
    if (ttsSettings.engine === 'local' && typeof window !== 'undefined' && window.speechSynthesis) {
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
      utteranceRef.current.onerror = null;
      utteranceRef.current = null;
    }
    if(resetUIState) {
        setIsSpeaking(false);
        setIsPaused(false);
        setIsLoadingTTS(false);
    }
  }, [ttsSettings.engine]);

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
          setTtsSettings(prev => ({ ...prev, voiceURI: defaultVoice.voiceURI, language: defaultVoice.lang }));
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
      stopSpeech(true);
    };
  }, [populateVoiceList, stopSpeech]);


  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;

    const handleAudioEnded = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      setIsLoadingTTS(false);
    };
     const handleAudioPlaying = () => {
        if (ttsSettings.engine === 'cloud' && isSpeaking) {
            setIsLoadingTTS(false);
            setIsPaused(false);
        }
    };
    const handleAudioError = (e: Event) => {
      toast({variant: "destructive", title: "Audio Error", description: "Failed to load or play audio."});
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
      player.src = ""; // Release resource
      if (audioPlayerRef.current === player) audioPlayerRef.current = null;
    };
  }, [ttsSettings.engine, isSpeaking, toast, stopSpeech]);


  const playPauseSpeech = async () => {
    if (!extractedText || extractedText.startsWith("Error:") || !loadedDocument) {
      toast({ variant: "destructive", title: "No Text", description: "No valid document text available to read." });
      return;
    }

    if (isSpeaking) {
      if (isPaused) { // Resume
        if (ttsSettings.engine === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
            if (window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
                setIsPaused(false);
                setTimeout(() => {
                    if (utteranceRef.current && isSpeaking && !isPaused && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
                        stopSpeech(true); 
                    }
                }, 100);
            } else {
                 stopSpeech(true);
            }
        } else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current && audioPlayerRef.current.paused) {
          audioPlayerRef.current.play().catch(e => {
            toast({variant: "destructive", title: "Resume Error", description: "Could not resume audio."});
            stopSpeech(true);
          });
          setIsPaused(false);
        }
      } else { // Pause
        if (ttsSettings.engine === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
          window.speechSynthesis.pause();
          setIsPaused(true);
        } else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current && !audioPlayerRef.current.paused) {
          audioPlayerRef.current.pause();
          setIsPaused(true);
        }
      }
    } else { // Play
      stopSpeech(false);
      setIsLoadingTTS(true);
      setIsSpeaking(true);
      setIsPaused(false);

      if (ttsSettings.engine === 'local') {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
          toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
          stopSpeech(true);
          return;
        }
        const utterance = new SpeechSynthesisUtterance(extractedText);
        utterance.lang = ttsSettings.language;
        utterance.pitch = ttsSettings.pitch;
        utterance.rate = ttsSettings.rate;
        const selectedVoice = availableVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
        if (selectedVoice) {
          const browserVoice = window.speechSynthesis.getVoices().find(v => v.voiceURI === selectedVoice.voiceURI);
          if (browserVoice) utterance.voice = browserVoice;
        }
        utterance.onend = () => { if(utteranceRef.current === utterance) stopSpeech(true); };
        utterance.onerror = (event) => {
          if(utteranceRef.current === utterance) {
            toast({ variant: "destructive", title: "TTS Error", description: event.error || "Failed to play speech." });
            stopSpeech(true);
          }
        };
        utteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
        setIsLoadingTTS(false);

      } else { // Cloud TTS
        try {
          const result = await getCloudSpeech(extractedText, ttsSettings.language);
          if ('audioUrl' in result && audioPlayerRef.current) {
            audioPlayerRef.current.src = result.audioUrl;
            await audioPlayerRef.current.play();
            // setLoadingTTS will be set to false by handleAudioPlaying
          } else if ('error' in result) {
            toast({ variant: "destructive", title: "Cloud TTS Error", description: result.error });
            stopSpeech(true);
          }
        } catch (error: any) {
          toast({ variant: "destructive", title: "Cloud TTS Request Failed", description: error.message || "Unknown error." });
          stopSpeech(true);
        }
      }
    }
  };

  const handleSettingChange = <K extends keyof ReaderTTSSettings>(key: K, value: ReaderTTSSettings[K]) => {
    stopSpeech(true);
    const newSettings = { ...ttsSettings, [key]: value };
    setTtsSettings(newSettings);
    LocalStorage.saveTTSSettings(newSettings);
    if (key === 'language' && ttsSettings.engine === 'local') {
        const suitableVoice = availableVoices.find(v => v.lang === value && v.default) || availableVoices.find(v => v.lang === value);
        if (suitableVoice) {
            setTtsSettings(prev => ({...prev, voiceURI: suitableVoice.voiceURI}));
        } else {
            setTtsSettings(prev => ({...prev, voiceURI: undefined}));
        }
    }
  };
  
  const getButtonState = () => {
    const canPlay = !!(extractedText && !extractedText.startsWith("Error:") && loadedDocument && !isLoadingDocument);
    if (isLoadingTTS) return { text: "Loading...", icon: <Loader2 className="mr-2 h-4 w-4 animate-spin" />, disabled: true, action: () => {} };
    if (isSpeaking) {
      return isPaused ?
        { text: "Resume", icon: <Play className="mr-2 h-4 w-4" />, disabled: false, action: playPauseSpeech } :
        { text: "Pause", icon: <Pause className="mr-2 h-4 w-4" />, disabled: false, action: playPauseSpeech };
    }
    return { text: "Play", icon: <Play className="mr-2 h-4 w-4" />, disabled: !canPlay, action: playPauseSpeech };
  };

  const buttonState = getButtonState();

  const handleFavoriteSelection = () => {
    const selection = window.getSelection()?.toString().trim();
    if (selection && loadedDocument) {
      const newFavorite: FavoriteItem = {
        id: Date.now().toString(),
        text: selection,
        sourceDocumentId: loadedDocument.id,
        sourceDocumentName: loadedDocument.name,
        createdAt: Date.now(),
      };
      LocalStorage.addFavoriteItem(newFavorite);
      toast({ title: "Favorited!", description: `"${selection.substring(0, 30)}..." added to favorites.` });
    } else if (!selection) {
      toast({ variant: "destructive", title: "No Selection", description: "Please select text to favorite." });
    }
  };


  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {!docId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Info className="text-primary" /> Document Reader</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Please go to your <Button variant="link" className="p-0 h-auto" onClick={() => router.push('/library')}>Library</Button> to select a document to read.</p>
          </CardContent>
        </Card>
      )}

      {isLoadingDocument && docId && (
        <Card>
          <CardContent className="pt-6 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mr-2" />
            <p>Loading document: {fileName || "Details"}...</p>
          </CardContent>
        </Card>
      )}

      {docId && !isLoadingDocument && !loadedDocument && (
         <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="text-destructive" /> Document Not Found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-destructive-foreground">The document with ID "{docId}" could not be found in your library or failed to load.</p>
            <Button variant="link" onClick={() => router.push('/library')} className="mt-2">Go to Library</Button>
          </CardContent>
        </Card>
      )}


      {loadedDocument && !isLoadingDocument && (
        <Card>
          <CardHeader>
            <CardTitle className="truncate" title={fileName || "Document"}>Document: {fileName || "Untitled"}</CardTitle>
            <CardDescription>Type: {loadedDocument.type.toUpperCase()}</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={extractedText}
              readOnly
              placeholder={extractedText.startsWith("Error:") ? extractedText : "Text content will appear here..."}
              className={`min-h-[300px] max-h-[50vh] text-sm ${extractedText.startsWith("Error:") ? 'bg-destructive/10 text-destructive-foreground' : 'bg-muted/30'}`}
            />
            <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="mt-2">
              <Star className="mr-2 h-4 w-4" /> Favorite Selected Text
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Text-to-Speech Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tts-engine">TTS Engine</Label>
              <Select value={ttsSettings.engine} onValueChange={(v) => handleSettingChange('engine', v as 'local' | 'cloud')} disabled={(isSpeaking && !isPaused) || !loadedDocument}>
                <SelectTrigger id="tts-engine">
                  <SelectValue placeholder="Select engine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local"><div className="flex items-center gap-1"><Smartphone className="h-4 w-4" /> Local Browser</div></SelectItem>
                  <SelectItem value="cloud"><div className="flex items-center gap-1"><CloudIcon className="h-4 w-4"/> Cloud API</div></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tts-language">Language (e.g., en-US, zh-CN)</Label>
              <Input
                id="tts-language"
                value={ttsSettings.language}
                onChange={(e) => handleSettingChange('language', e.target.value)}
                disabled={(isSpeaking && !isPaused) || (ttsSettings.engine === 'local' && availableVoices.length === 0) || !loadedDocument}
              />
            </div>
          </div>

          {ttsSettings.engine === 'local' && (
             <div>
              <Label htmlFor="tts-voice">Voice (Local)</Label>
              <Select
                value={ttsSettings.voiceURI}
                onValueChange={(v) => handleSettingChange('voiceURI', v)}
                disabled={(isSpeaking && !isPaused) || availableVoices.filter(voice => voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 || !loadedDocument}
              >
                <SelectTrigger id="tts-voice">
                  <SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No voices available for this language/engine"} />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {availableVoices.filter(voice => voice.lang.startsWith(ttsSettings.language.split('-')[0])).map(voice => (
                    <SelectItem key={voice.voiceURI || voice.name} value={voice.voiceURI}>
                      {voice.name} ({voice.lang}) {voice.default ? "[Default]" : ""}
                    </SelectItem>
                  ))}
                  {availableVoices.filter(voice => voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (
                    <SelectItem value="no-voice" disabled>
                        {availableVoices.length > 0 ? "No voices for selected language" : "No local voices found in browser"}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="tts-rate">Rate: {ttsSettings.rate.toFixed(1)}</Label>
            <Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={(isSpeaking && !isPaused) || !loadedDocument}/>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tts-pitch">Pitch: {ttsSettings.pitch.toFixed(1)}</Label>
            <Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={(isSpeaking && !isPaused) || !loadedDocument}/>
          </div>

          <Button onClick={buttonState.action} disabled={buttonState.disabled} className="w-full md:w-auto">
            {buttonState.icon}
            {buttonState.text}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
