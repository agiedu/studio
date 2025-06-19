
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation'; // Removed useSearchParams as docId is no longer used
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Loader2, Play, Pause, Smartphone, Cloud as CloudIcon, Info, Star } from 'lucide-react';
import { getCloudSpeech } from '@/app/actions';
import * as LocalStorage from '@/lib/localStorageService';
import type { TTSVoice, FavoriteItem, TTSSettings as GlobalTTSSettings } from '@/types'; // Removed StoredDocument
import { cn } from '@/lib/utils';

// PDF.js related imports are removed as this page no longer loads PDFs directly from browser storage

export default function ReaderPage() {
  const { toast } = useToast();
  const router = useRouter();

  // State related to document loading from browser storage is removed
  const [fileName, setFileName] = useState<string | null>(null); // Could be used if file context is passed some other way
  const [extractedText, setExtractedText] = useState<string>(""); // Can be populated by manual input or future integrations
  const [isLoadingTTS, setIsLoadingTTS] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  const [ttsSettings, setTtsSettings] = useState<GlobalTTSSettings>(LocalStorage.defaultTTSSettings);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);
  
  const [sentenceSegments, setSentenceSegments] = useState<string[]>([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number>(-1);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // GlobalWorkerOptions.workerSrc removed as PDF.js is not used here directly
      setTtsSettings(LocalStorage.loadTTSSettings());
    }
    // Initial message if no text is present
    setExtractedText("This page is for reading text aloud. You can paste text into the area below (if enabled) or use the Read2 page to upload and process documents for a reading session.");
  }, []);

  // Removed useEffect that loaded document based on docId


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
        setIsPaused(false);
        setIsLoadingTTS(false);
        setCurrentSentenceIndex(-1);
        setSentenceSegments([]); // Clear segments on stop for local TTS
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
            LocalStorage.saveTTSSettings(newSettings);
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


  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;

    const handleAudioEnded = () => stopSpeech(true);
    const handleAudioPlaying = () => {
      if (ttsSettings.type === 'cloud' && isSpeaking) setIsLoadingTTS(false);
    };
    const handleAudioError = () => {
      toast({variant: "destructive", title: "Audio Error", description: "Failed to play audio."});
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


  const playPauseSpeech = async () => {
    const effectiveTextToRead = window.getSelection()?.toString().trim() || extractedText;

    if (!effectiveTextToRead || effectiveTextToRead.startsWith("Error:") || effectiveTextToRead.startsWith("This page is for reading text aloud")) {
      toast({ variant: "destructive", title: "No Text", description: "No valid text available to read." });
      return;
    }

    if (isSpeaking) { 
      if (isPaused) { 
        if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
            if (window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
                setIsPaused(false);
                setTimeout(() => { // Check if speech actually resumed
                    if (utteranceRef.current && isSpeaking && !isPaused && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
                        stopSpeech(true); 
                    }
                }, 100);
            } else { 
                 stopSpeech(true);
            }
        } else if (ttsSettings.type === 'cloud' && audioPlayerRef.current?.paused) {
          audioPlayerRef.current.play().catch(() => stopSpeech(true));
          setIsPaused(false);
        }
      } else { 
        if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
          window.speechSynthesis.pause();
          setIsPaused(true);
        } else if (ttsSettings.type === 'cloud' && audioPlayerRef.current && !audioPlayerRef.current.paused) {
          audioPlayerRef.current.pause();
          setIsPaused(true);
        }
      }
    } else { 
      stopSpeech(false); 
      setIsLoadingTTS(true);
      setIsSpeaking(true);
      setIsPaused(false);

      if (ttsSettings.type === 'local') {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
          toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
          stopSpeech(true); return;
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
            for (let i = 0; i < segments.length; i++) {
                if (event.charIndex >= cumulativeLength && event.charIndex < cumulativeLength + segments[i].length) {
                    if (utteranceRef.current === utterance) setCurrentSentenceIndex(i);
                    break;
                }
                cumulativeLength += segments[i].length;
            }
        };
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

      } else { 
        setSentenceSegments([]); 
        setCurrentSentenceIndex(-1);
        try {
          const result = await getCloudSpeech(effectiveTextToRead, ttsSettings.language);
          if ('audioUrl' in result && audioPlayerRef.current) {
            audioPlayerRef.current.src = result.audioUrl;
            await audioPlayerRef.current.play();
            // setIsLoadingTTS(false); // Cloud TTS loading is handled by audio player's 'playing' event
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

  const handleSettingChange = <K extends keyof GlobalTTSSettings>(key: K, value: GlobalTTSSettings[K]) => {
    stopSpeech(true);
    const newSettings = { ...ttsSettings, [key]: value };
    setTtsSettings(newSettings);
    LocalStorage.saveTTSSettings(newSettings); 
     if (key === 'language' && newSettings.type === 'local') {
        const suitableVoice = availableVoices.find(v => v.lang === value && v.default) || availableVoices.find(v => v.lang === value);
        if (suitableVoice) {
            setTtsSettings(prev => ({...prev, voiceURI: suitableVoice.voiceURI}));
            LocalStorage.saveTTSSettings({...newSettings, voiceURI: suitableVoice.voiceURI});
        } else {
            setTtsSettings(prev => ({...prev, voiceURI: undefined}));
            LocalStorage.saveTTSSettings({...newSettings, voiceURI: undefined});
        }
    }
  };
  
  const getButtonState = () => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const canPlay = !!(selectedText || (extractedText && !extractedText.startsWith("Error:") && !extractedText.startsWith("This page is for reading text aloud")));

    if (isLoadingTTS) return { text: "Loading...", icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, disabled: true, action: () => {} };
    if (isSpeaking) {
      return isPaused ?
        { text: "Resume", icon: <Play className="mr-1 h-4 w-4" />, disabled: false, action: playPauseSpeech } :
        { text: "Pause", icon: <Pause className="mr-1 h-4 w-4" />, disabled: false, action: playPauseSpeech };
    }
    return { 
        text: selectedText ? "Play Selected" : "Play All", 
        icon: <Play className="mr-1 h-4 w-4" />, 
        disabled: !canPlay, 
        action: playPauseSpeech 
    };
  };

  const buttonState = getButtonState();

  const handleFavoriteSelection = () => {
    const selection = window.getSelection()?.toString().trim();
    if (selection) {
      const newFavorite: FavoriteItem = {
        id: Date.now().toString(),
        text: selection,
        sourceDocumentId: fileName || "reader_text", // Use filename if available, or generic ID
        sourceDocumentName: fileName || "Reader Page Text",
        createdAt: Date.now(),
      };
      LocalStorage.addFavoriteItem(newFavorite);
      toast({ title: "Favorited!", description: `"${selection.substring(0, 30)}..." added to favorites.` });
    } else if (!selection) {
      toast({ variant: "destructive", title: "No Selection", description: "Please select text to favorite." });
    }
  };


  return (
    <div className="flex flex-col w-full p-4 md:p-6 space-y-6">
      {/* Document Content Area */}
      <div className="flex-grow space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Info className="text-primary" /> Text Reader</CardTitle>
              <CardDescription>
                This page is for Text-to-Speech. Documents are now managed via your local device using the helper service.
                Use the "Read2" page to upload documents for a reading session, or paste text below.
              </CardDescription>
            </CardHeader>
          </Card>
            <Card>
              <CardHeader>
                <CardTitle>Text Content</CardTitle>
                 <CardDescription>
                   {fileName ? `Reading: ${fileName}` : "Paste text below or select text on the page to read."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <textarea
                  value={extractedText}
                  onChange={(e) => {
                    stopSpeech(true); // Stop speech if text changes
                    setExtractedText(e.target.value);
                    setFileName(null); // Clear filename if text is manually changed
                  }}
                  placeholder="Paste text here to read aloud..."
                  className={cn(
                    "min-h-[200px] w-full max-h-[calc(100vh-30rem)] overflow-y-auto p-3 border rounded-md bg-muted/30 whitespace-pre-wrap text-sm select-text focus:ring-primary focus:border-primary",
                    extractedText.startsWith("Error:") && 'bg-destructive/10 text-destructive-foreground'
                  )}
                />
                <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="mt-3" disabled={!extractedText}>
                  <Star className="mr-2 h-4 w-4" /> Favorite Selected Text
                </Button>
              </CardContent>
            </Card>
      </div>

      {/* TTS Controls Area */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-lg">Text-to-Speech Controls</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div>
              <Label htmlFor="tts-engine" className="text-xs">TTS Engine</Label>
              <Select value={ttsSettings.type} onValueChange={(v) => handleSettingChange('type', v as 'local' | 'cloud')} disabled={(isSpeaking && !isPaused)}>
                <SelectTrigger id="tts-engine" className="h-9 text-xs">
                  <SelectValue placeholder="Select engine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local"><div className="flex items-center gap-1 text-xs"><Smartphone className="h-3 w-3" /> Local Browser</div></SelectItem>
                  <SelectItem value="cloud"><div className="flex items-center gap-1 text-xs"><CloudIcon className="h-3 w-3"/> Cloud API</div></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tts-language" className="text-xs">Language (e.g., en-US)</Label>
              <Input
                id="tts-language"
                className="h-9 text-xs"
                value={ttsSettings.language}
                onChange={(e) => handleSettingChange('language', e.target.value)}
                disabled={(isSpeaking && !isPaused) || (ttsSettings.type === 'local' && availableVoices.length === 0)}
              />
            </div>

            {ttsSettings.type === 'local' && (
              <div>
                <Label htmlFor="tts-voice" className="text-xs">Voice (Local)</Label>
                <Select
                  value={ttsSettings.voiceURI}
                  onValueChange={(v) => handleSettingChange('voiceURI', v)}
                  disabled={(isSpeaking && !isPaused) || availableVoices.filter(voice => voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0}
                >
                  <SelectTrigger id="tts-voice" className="h-9 text-xs">
                    <SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No voices for language"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-48">
                    {availableVoices.filter(voice => voice.lang.startsWith(ttsSettings.language.split('-')[0])).map(voice => (
                      <SelectItem key={voice.voiceURI || voice.name} value={voice.voiceURI} className="text-xs">
                        {voice.name} ({voice.lang}) {voice.default ? "[Def]" : ""}
                      </SelectItem>
                    ))}
                    {availableVoices.filter(voice => voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (
                      <SelectItem value="no-voice-reader" disabled>
                          {availableVoices.length > 0 ? "No voices for language" : "No local voices"}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="tts-rate" className="text-xs">Rate: {ttsSettings.rate.toFixed(1)}</Label>
              <Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={(isSpeaking && !isPaused)}/>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tts-pitch" className="text-xs">Pitch: {ttsSettings.pitch.toFixed(1)}</Label>
              <Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={(isSpeaking && !isPaused)}/>
            </div>

            <Button 
                onClick={buttonState.action} 
                disabled={buttonState.disabled} 
                variant={isSpeaking && !isPaused ? "outline" : "default"}
                className="w-full h-9 text-sm"
            >
              {buttonState.icon}
              {buttonState.text}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
