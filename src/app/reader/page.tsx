
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
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
import { Loader2, Play, Pause, UploadCloud, Smartphone, Cloud as CloudIcon } from 'lucide-react';
import { getCloudSpeech } from '@/app/actions'; // Reusing existing action

interface TTSVoice {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default: boolean;
}

interface ReaderTTSSettings {
  engine: 'local' | 'cloud';
  language: string;
  rate: number;
  pitch: number;
  voiceURI?: string;
}

export default function ReaderPage() {
  const { toast } = useToast();
  const [fileName, setFileName] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<string>("");
  const [isLoadingFile, setIsLoadingFile] = useState<boolean>(false);
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
    }
  }, []);

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
      player.src = "";
      if (audioPlayerRef.current === player) audioPlayerRef.current = null;
    };
  }, [ttsSettings.engine, isSpeaking, toast, stopSpeech]);


  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    stopSpeech(true);
    setIsLoadingFile(true);
    setFileName(file.name);
    setExtractedText("");

    if (file.type === 'text/plain') {
      const reader = new FileReader();
      reader.onload = (e) => {
        setExtractedText(e.target?.result as string);
        setIsLoadingFile(false);
      };
      reader.onerror = () => {
        toast({ variant: "destructive", title: "File Read Error", description: "Could not read TXT file." });
        setIsLoadingFile(false);
      };
      reader.readAsText(file);
    } else if (file.type === 'application/pdf') {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const pdfData = e.target?.result as ArrayBuffer;
        if (!pdfData) {
          toast({ variant: "destructive", title: "PDF Read Error", description: "Could not read PDF data." });
          setIsLoadingFile(false);
          return;
        }
        try {
          const pdf = await getDocument({ data: pdfData }).promise;
          let fullText = "";
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => ('str' in item ? item.str : '')).join(" ") + "\n\n";
          }
          setExtractedText(fullText.trim());
        } catch (error: any) {
          console.error("PDF Processing Error:", error);
          toast({ variant: "destructive", title: "PDF Processing Error", description: error.message || "Failed to extract text from PDF." });
          setExtractedText("Error processing PDF. It might be image-based or corrupted.");
        } finally {
          setIsLoadingFile(false);
        }
      };
      reader.onerror = () => {
        toast({ variant: "destructive", title: "File Read Error", description: "Could not read PDF file." });
        setIsLoadingFile(false);
      };
      reader.readAsArrayBuffer(file);
    } else {
      toast({ variant: "destructive", title: "Unsupported File Type", description: "Please upload a TXT or PDF file." });
      setFileName(null);
      setIsLoadingFile(false);
    }
    if (event.target) event.target.value = ''; // Reset file input
  };

  const playPauseSpeech = async () => {
    if (!extractedText) {
      toast({ variant: "destructive", title: "No Text", description: "No text available to read." });
      return;
    }

    if (isSpeaking) {
      if (isPaused) { // Resume
        if (ttsSettings.engine === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
            setIsPaused(false);
          } else { // State mismatch, force stop.
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
      stopSpeech(false); // Stop any previous speech, but don't reset UI yet for loading
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
    setTtsSettings(prev => ({ ...prev, [key]: value }));
  };
  
  const getButtonState = () => {
    if (isLoadingTTS) return { text: "Loading...", icon: <Loader2 className="mr-2 h-4 w-4 animate-spin" />, disabled: true, action: () => {} };
    if (isSpeaking) {
      return isPaused ? 
        { text: "Resume", icon: <Play className="mr-2 h-4 w-4" />, disabled: false, action: playPauseSpeech } :
        { text: "Pause", icon: <Pause className="mr-2 h-4 w-4" />, disabled: false, action: playPauseSpeech };
    }
    return { text: "Play", icon: <Play className="mr-2 h-4 w-4" />, disabled: !extractedText || isLoadingFile, action: playPauseSpeech };
  };

  const buttonState = getButtonState();

  return (
    <div className="w-full p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Upload Document for Reading</CardTitle>
          <CardDescription>Upload a TXT or PDF (text-based) file. EPUB/MOBI not supported.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full max-w-md items-center gap-1.5">
            <Label htmlFor="doc-upload">Document File (.txt, .pdf)</Label>
            <Input id="doc-upload" type="file" accept=".txt,application/pdf" onChange={handleFileUpload} disabled={isLoadingFile} />
          </div>
          {isLoadingFile && <p className="mt-2 text-sm text-muted-foreground">Loading file: {fileName}...</p>}
        </CardContent>
      </Card>

      {fileName && (
        <Card>
          <CardHeader>
            <CardTitle>Document Content: {fileName}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={extractedText}
              readOnly
              placeholder={isLoadingFile ? "Extracting text..." : "No text extracted or file not loaded."}
              className="min-h-[300px] max-h-[50vh] text-sm bg-muted/30"
            />
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
              <Select value={ttsSettings.engine} onValueChange={(v) => handleSettingChange('engine', v as 'local' | 'cloud')} disabled={isSpeaking && !isPaused}>
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
                disabled={(isSpeaking && !isPaused) || (ttsSettings.engine === 'local' && availableVoices.length === 0)}
              />
            </div>
          </div>

          {ttsSettings.engine === 'local' && (
             <div>
              <Label htmlFor="tts-voice">Voice (Local)</Label>
              <Select 
                value={ttsSettings.voiceURI} 
                onValueChange={(v) => handleSettingChange('voiceURI', v)} 
                disabled={(isSpeaking && !isPaused) || availableVoices.filter(voice => voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0}
              >
                <SelectTrigger id="tts-voice">
                  <SelectValue placeholder="Select voice (ensure language is set)" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {availableVoices.filter(voice => voice.lang.startsWith(ttsSettings.language.split('-')[0])).map(voice => (
                    <SelectItem key={voice.voiceURI || voice.name} value={voice.voiceURI}>
                      {voice.name} ({voice.lang}) {voice.default ? "[Default]" : ""}
                    </SelectItem>
                  ))}
                  {availableVoices.filter(voice => voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (
                    <SelectItem value="no-voice" disabled>No voices for selected language</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="tts-rate">Rate: {ttsSettings.rate.toFixed(1)}</Label>
            <Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={isSpeaking && !isPaused}/>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tts-pitch">Pitch: {ttsSettings.pitch.toFixed(1)}</Label>
            <Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={isSpeaking && !isPaused}/>
          </div>
          
          <Button onClick={buttonState.action} disabled={buttonState.disabled} className="w-full md:w-auto">
            {buttonState.icon}
            {buttonState.text}
          </Button>
        </CardContent>
      </Card>
       <Card>
        <CardHeader><CardTitle>Note on UI Language</CardTitle></CardHeader>
        <CardContent>
            <p className="text-sm text-muted-foreground">
                Full UI language switching (e.g., to Chinese) is a complex feature.
                A language selector could be added here or in the header in the future.
            </p>
        </CardContent>
       </Card>
    </div>
  );
}

    