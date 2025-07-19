
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Trash2, Info, NotebookText, FileText, Play, Pause, Loader2, Smartphone, Cloud as CloudIcon, Star } from 'lucide-react';
import * as LocalStorage from '@/lib/localStorageService';
import type { NoteFavoriteItem, TTSVoice, TTSSettings } from '@/types';
import { format } from 'date-fns';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AppHeader } from '@/components/app/AppHeader';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { getCloudSpeech } from '@/app/actions';
import { edgeTTSLanguageVoices } from '@/lib/edge-tts-voices';
import { Separator } from '@/components/ui/separator';

const PUNCTUATION_REGEX_FOR_SPLIT = /([.,?!,。？！，、\n\r]+)/g;
const PUNCTUATION_REGEX_FOR_CLEANUP = /[.,?!,。？！，、\n\r"“„”'‘’`*_{}\[\]()#&@:;~<>/\\|\-—–^%$]/g;

const groupVoicesByLanguage = (voices: TTSVoice[]) => {
  return voices.reduce((acc, voice) => {
    const lang = voice.lang || 'Unknown';
    if (!acc[lang]) {
      acc[lang] = [];
    }
    acc[lang].push(voice);
    return acc;
  }, {} as Record<string, TTSVoice[]>);
};

// A new component to render text with highlighting
const HighlightableText: React.FC<{
  text: string;
  isSpeaking: boolean;
  highlightedSegmentIndex: number;
  segments: string[];
}> = ({ text, isSpeaking, highlightedSegmentIndex, segments }) => {
  if (!isSpeaking || highlightedSegmentIndex < 0) {
    return <>{text ? `"${text}"` : "No original text."}</>;
  }

  const preText = segments.slice(0, highlightedSegmentIndex).join('');
  const highlightedText = segments[highlightedSegmentIndex];
  const postText = segments.slice(highlightedSegmentIndex + 1).join('');

  return (
    <>
      &quot;{preText}
      <span className="text-green-600 dark:text-green-500 bg-green-500/10 rounded">{highlightedText}</span>
      {postText}&quot;
    </>
  );
};

function NotesFavoritesPageContent() {
  const { toast } = useToast();
  const [favoriteNotes, setFavoriteNotes] = useState<NoteFavoriteItem[]>([]);
  const [noteToDelete, setNoteToDelete] = useState<NoteFavoriteItem | null>(null);

  const [isLoadingTTS, setIsLoadingTTS] = useState(false);
  const [speakingItemId, setSpeakingItemId] = useState<string | null>(null);
  const [pausedItemId, setPausedItemId] = useState<string | null>(null);
  
  const [originalTextTtsSettings, setOriginalTextTtsSettings] = useState<TTSSettings>(LocalStorage.defaultTTSSettings);
  const [yourNoteTtsSettings, setYourNoteTtsSettings] = useState<TTSSettings>(LocalStorage.defaultTTSSettings);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);

  const [highlightedSegmentIndex, setHighlightedSegmentIndex] = useState(-1);
  const [currentlySpeakingPart, setCurrentlySpeakingPart] = useState<'original' | 'note' | null>(null);
  const segmentIndexRef = useRef(0);
  const isSpeakingRef = useRef(false);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechQueueRef = useRef<{ text: string; settings: TTSSettings; part: 'original' | 'note', segments: string[] }[]>([]);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Load initial settings and favorite items
  useEffect(() => {
    setFavoriteNotes(LocalStorage.loadNoteFavorites());

    const loadAndSetSettings = (loader: () => TTSSettings, setter: React.Dispatch<React.SetStateAction<TTSSettings>>) => {
        const loadedSettings = loader();
        const merged = {
            ...LocalStorage.defaultTTSSettings,
            ...loadedSettings,
            engine: loadedSettings.engine || loadedSettings.type || 'local',
        };
        if (merged.engine === 'cloud' && (!merged.language || !merged.cloudVoiceId)) {
            const defaultLocale = 'en-US';
            merged.language = defaultLocale;
            if (edgeTTSLanguageVoices[defaultLocale]?.voices.length > 0) {
              merged.cloudVoiceId = edgeTTSLanguageVoices[defaultLocale].voices[0].id;
            }
        }
        setter(merged);
    };

    loadAndSetSettings(LocalStorage.loadOriginalTextTTSSettings, setOriginalTextTtsSettings);
    loadAndSetSettings(LocalStorage.loadYourNoteTTSSettings, setYourNoteTtsSettings);
  }, []);

  // Save TTS settings to LocalStorage whenever they change
  useEffect(() => {
    LocalStorage.saveOriginalTextTTSSettings(originalTextTtsSettings);
  }, [originalTextTtsSettings]);
  useEffect(() => {
    LocalStorage.saveYourNoteTTSSettings(yourNoteTtsSettings);
  }, [yourNoteTtsSettings]);
  
  const stopSpeechGlobal = useCallback((resetUIState = true) => {
    isSpeakingRef.current = false;
    speechQueueRef.current = [];
    if (utteranceRef.current) {
      utteranceRef.current.onend = null;
      utteranceRef.current.onerror = null;
      utteranceRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      if (audioPlayerRef.current.src && audioPlayerRef.current.readyState >= HTMLMediaElement.HAVE_METADATA) {
        try { audioPlayerRef.current.currentTime = 0; } catch (e) { /* ignore */ }
      }
    }
    if (resetUIState && isMountedRef.current) {
      setIsLoadingTTS(false);
      setSpeakingItemId(null);
      setPausedItemId(null);
      setHighlightedSegmentIndex(-1);
      setCurrentlySpeakingPart(null);
    }
  }, []);

  const populateVoiceList = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const voices = window.speechSynthesis.getVoices().map(v => ({
        name: v.name,
        lang: v.lang,
        voiceURI: v.voiceURI,
        localService: v.localService,
        default: v.default,
      }));
      if (isMountedRef.current) {
        setAvailableVoices(voices);
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
      stopSpeechGlobal(true); 
    };
  }, [populateVoiceList, stopSpeechGlobal]);

  const speakNextSegment = useCallback(async () => {
    if (!isSpeakingRef.current || speechQueueRef.current.length === 0) {
      stopSpeechGlobal(true);
      return;
    }

    const currentPart = speechQueueRef.current[0];
    if (segmentIndexRef.current >= currentPart.segments.length) {
      // Finished with current part (original/note), move to next in queue
      speechQueueRef.current.shift();
      segmentIndexRef.current = 0;
      speakNextSegment();
      return;
    }
    
    if (isMountedRef.current) {
      setIsLoadingTTS(true);
      setCurrentlySpeakingPart(currentPart.part);
      setHighlightedSegmentIndex(segmentIndexRef.current);
    }

    const segmentText = currentPart.segments[segmentIndexRef.current];
    const cleanedText = segmentText.replace(PUNCTUATION_REGEX_FOR_CLEANUP, ' ').trim();

    if (!cleanedText) { // Skip empty segments
      segmentIndexRef.current++;
      speakNextSegment();
      return;
    }
    
    if (currentPart.settings.engine === 'local') {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
        stopSpeechGlobal(true);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(cleanedText);
      utterance.lang = currentPart.settings.language;
      utterance.pitch = currentPart.settings.pitch;
      utterance.rate = currentPart.settings.rate;
      const voice = availableVoices.find(v => v.voiceURI === currentPart.settings.voiceURI);
      if (voice) utterance.voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === voice.voiceURI);
      
      utterance.onend = () => { if(utteranceRef.current === utterance) { segmentIndexRef.current++; speakNextSegment(); } };
      utterance.onerror = (event) => {
          if(utteranceRef.current === utterance) {
              toast({ variant: "destructive", title: "TTS Error", description: event.error || "Speech failed." });
              stopSpeechGlobal(true);
          }
      };
      utteranceRef.current = utterance;
      if (isMountedRef.current) setIsLoadingTTS(false);
      window.speechSynthesis.speak(utterance);
    } else { // Cloud engine
      try {
        const result = await getCloudSpeech(cleanedText, currentPart.settings.language, currentPart.settings.cloudVoiceId);
        if (!isMountedRef.current || !isSpeakingRef.current) return;
        if ('audioUrl' in result && audioPlayerRef.current) {
          audioPlayerRef.current.src = result.audioUrl;
          await audioPlayerRef.current.play(); // The 'ended' event will trigger next segment
        } else if ('error' in result) {
          toast({ variant: "destructive", title: "Cloud TTS Error", description: result.error });
          stopSpeechGlobal(true);
        }
      } catch (error: any) {
        if (!isMountedRef.current) return;
        toast({ variant: "destructive", title: "Cloud TTS Failed", description: error.message });
        stopSpeechGlobal(true);
      }
    }
  }, [availableVoices, stopSpeechGlobal, toast]);

  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;
    const handleAudioEnded = () => {
      if(isSpeakingRef.current){
        segmentIndexRef.current++;
        speakNextSegment();
      }
    };
    const handleAudioPlaying = () => {
      if (isMountedRef.current && speakingItemId) setIsLoadingTTS(false);
    };
    const handleAudioError = () => {
      if (isMountedRef.current) {
          toast({variant: "destructive", title: "Audio Error", description: "Failed to play audio."});
          stopSpeechGlobal(true);
      }
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
      if(audioPlayerRef.current === player) audioPlayerRef.current = null;
    };
  }, [speakingItemId, toast, stopSpeechGlobal, speakNextSegment]);

  const handlePlayPauseNote = async (item: NoteFavoriteItem) => {
      if (speakingItemId === item.id) { // This item is currently speaking or paused
          if (pausedItemId === item.id) { // It's paused, so resume it
              setPausedItemId(null);
              if (utteranceRef.current) {
                  if (typeof window !== 'undefined' && window.speechSynthesis) {
                      window.speechSynthesis.resume();
                  }
              } else if (audioPlayerRef.current) {
                  audioPlayerRef.current.play().catch(() => stopSpeechGlobal(true));
              }
          } else { // It's playing, so pause it
              setPausedItemId(item.id);
              if (utteranceRef.current && typeof window !== 'undefined' && window.speechSynthesis) {
                  window.speechSynthesis.pause();
              } else if (audioPlayerRef.current) {
                  audioPlayerRef.current.pause();
              }
          }
      } else { // A new item is being played
          stopSpeechGlobal(false);
          setSpeakingItemId(item.id);
          setPausedItemId(null);
          isSpeakingRef.current = true;
          segmentIndexRef.current = 0;
          
          speechQueueRef.current = [];
          if (item.annotation.targetText) {
              const parts = item.annotation.targetText.split(PUNCTUATION_REGEX_FOR_SPLIT);
              const segments = [];
              for (let i = 0; i < parts.length; i += 2) {
                  const text = parts[i];
                  const delimiter = parts[i + 1] || '';
                  if (text || delimiter) segments.push(text + delimiter);
              }
              speechQueueRef.current.push({ text: item.annotation.targetText, settings: originalTextTtsSettings, part: 'original', segments });
          }
          if (item.annotation.note) {
              const parts = item.annotation.note.split(PUNCTUATION_REGEX_FOR_SPLIT);
              const segments = [];
              for (let i = 0; i < parts.length; i += 2) {
                  const text = parts[i];
                  const delimiter = parts[i + 1] || '';
                  if (text || delimiter) segments.push(text + delimiter);
              }
              speechQueueRef.current.push({ text: item.annotation.note, settings: yourNoteTtsSettings, part: 'note', segments });
          }
  
          if (speechQueueRef.current.length === 0) {
              toast({ variant: 'destructive', title: 'No Text', description: 'This note has no text to read.' });
              stopSpeechGlobal(true);
              return;
          }
          
          speakNextSegment();
      }
  };


  const performDelete = () => {
    if (!noteToDelete) return;
    if (speakingItemId === noteToDelete.id) stopSpeechGlobal(true);
    LocalStorage.deleteNoteFavorite(noteToDelete.id);
    setFavoriteNotes(prev => prev.filter(item => item.id !== noteToDelete.id));
    toast({ title: "Note Favorite Removed" });
    setNoteToDelete(null); // Close the dialog
  };
  
  const handleSettingChange = (
      panel: 'original' | 'note',
      key: keyof TTSSettings,
      value: any
  ) => {
      stopSpeechGlobal(true);
  
      const setter = panel === 'original' ? setOriginalTextTtsSettings : setYourNoteTtsSettings;
  
      setter(prevSettings => {
          let newSettings = { ...prevSettings, [key]: value };
  
          if (key === 'engine') {
              newSettings.type = value as 'local' | 'cloud';
              if (value === 'cloud') {
                  const currentLang = newSettings.language;
                  const cloudLangData = edgeTTSLanguageVoices[currentLang];
                  if (!cloudLangData || !cloudLangData.voices.length) {
                      const defaultLocale = 'en-US';
                      newSettings.language = defaultLocale;
                      newSettings.cloudVoiceId = edgeTTSLanguageVoices[defaultLocale].voices[0].id;
                  } else if (!newSettings.cloudVoiceId?.startsWith(currentLang)) {
                      newSettings.cloudVoiceId = cloudLangData.voices[0].id;
                  }
              } else if (value === 'local') {
                  const currentVoice = availableVoices.find(v => v.voiceURI === newSettings.voiceURI);
                  if (!currentVoice) {
                      const defaultVoice = availableVoices.find(v => v.default && v.lang) || availableVoices[0];
                      if (defaultVoice) {
                          newSettings.voiceURI = defaultVoice.voiceURI;
                          newSettings.language = defaultVoice.lang;
                      }
                  }
              }
          }
  
          if (key === 'language' && newSettings.engine === 'cloud') {
              const newLang = value as string;
              const langVoices = edgeTTSLanguageVoices[newLang]?.voices;
              if (langVoices && langVoices.length > 0) {
                  newSettings.cloudVoiceId = langVoices[0].id;
              } else {
                  newSettings.cloudVoiceId = undefined;
              }
          }
  
          if (key === 'voiceURI' && newSettings.engine === 'local' && value) {
              const selectedVoice = availableVoices.find(v => v.voiceURI === value);
              if (selectedVoice) {
                  newSettings.language = selectedVoice.lang;
              }
          }
          
          return newSettings;
      });
  };

  const groupedLocalVoices = groupVoicesByLanguage(availableVoices);

  const renderTtsPanel = (
    panelType: 'original' | 'note',
    title: string,
    settings: TTSSettings,
  ) => {
    const handlePanelChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
      handleSettingChange(panelType, key, value);
    };

    return (
      <div className="mb-4">
        <h3 className="text-lg font-medium mb-3">{title}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
            <div>
                <Label htmlFor={`${panelType}-tts-engine`}>TTS Engine</Label>
                <Select value={settings.engine} onValueChange={(v) => handlePanelChange('engine', v as 'local' | 'cloud')} disabled={!!speakingItemId && !pausedItemId}>
                    <SelectTrigger id={`${panelType}-tts-engine`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local"><div className="flex items-center gap-1"><Smartphone className="h-4 w-4" /> Local</div></SelectItem>
                      <SelectItem value="cloud"><div className="flex items-center gap-1"><CloudIcon className="h-4 w-4"/> Cloud</div></SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>

        {settings.engine === 'local' && (
            <div className="mb-3">
                <Label htmlFor={`${panelType}-tts-voice`}>Voice (Local)</Label>
                <Select
                    value={settings.voiceURI || ""}
                    onValueChange={(v) => handlePanelChange('voiceURI', v)}
                    disabled={!!speakingItemId && !pausedItemId || availableVoices.length === 0}
                >
                    <SelectTrigger id={`${panelType}-tts-voice`}><SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No local voices found"} /></SelectTrigger>
                    <SelectContent className="max-h-60">
                        {availableVoices.length === 0 ? (
                            <SelectItem value="no-voices" disabled>No local voices found on this device</SelectItem>
                        ) : (
                            Object.entries(groupedLocalVoices).map(([lang, voices]) => (
                                <SelectGroup key={lang}>
                                    <SelectLabel>{lang}</SelectLabel>
                                    {voices.map(voice => (
                                        <SelectItem key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</SelectItem>
                                    ))}
                                </SelectGroup>
                            ))
                        )}
                    </SelectContent>
                </Select>
            </div>
        )}

        {settings.engine === 'cloud' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                <div>
                    <Label htmlFor={`${panelType}-cloud-tts-language`}>Language (Cloud)</Label>
                    <Select value={settings.language} onValueChange={(v) => handlePanelChange('language', v as string)} disabled={!!speakingItemId && !pausedItemId}>
                        <SelectTrigger id={`${panelType}-cloud-tts-language`}><SelectValue placeholder="Select a language" /></SelectTrigger>
                        <SelectContent className="max-h-60">
                            {Object.entries(edgeTTSLanguageVoices).map(([locale, { language }]) => (
                                <SelectItem key={locale} value={locale}>{language} ({locale})</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label htmlFor={`${panelType}-cloud-tts-voice`}>Voice (Cloud)</Label>
                    <Select value={settings.cloudVoiceId || ""} onValueChange={(v) => handlePanelChange('cloudVoiceId', v)} disabled={!!speakingItemId && !pausedItemId || !settings.language}>
                        <SelectTrigger id={`${panelType}-cloud-tts-voice`}><SelectValue placeholder="Select a voice" /></SelectTrigger>
                        <SelectContent className="max-h-60">
                            {(edgeTTSLanguageVoices[settings.language]?.voices || []).map(voice => (
                                <SelectItem key={voice.id} value={voice.id}>{voice.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        )}

        <div className="space-y-2 mb-3">
            <Label htmlFor={`${panelType}-tts-rate`}>Rate: {settings.rate.toFixed(1)}</Label>
            <Slider id={`${panelType}-tts-rate`} min={0.5} max={2} step={0.1} value={[settings.rate]} onValueChange={([v]) => handlePanelChange('rate', v)} disabled={!!speakingItemId && !pausedItemId}/>
        </div>
        <div className="space-y-2">
            <Label htmlFor={`${panelType}-tts-pitch`}>Pitch: {settings.pitch.toFixed(1)}</Label>
            <Slider id={`${panelType}-tts-pitch`} min={0} max={2} step={0.1} value={[settings.pitch]} onValueChange={([v]) => handlePanelChange('pitch', v)} disabled={!!speakingItemId && !pausedItemId}/>
        </div>
      </div>
    );
  };


  return (
    <>
      <AppHeader />
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><NotebookText className="text-primary" /> My Note Favorites</CardTitle>
            <CardDescription>Your saved annotations. Click to review, play or delete.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6 p-4 border rounded-md bg-muted/20">
                {renderTtsPanel('original', 'Original Text TTS Settings', originalTextTtsSettings)}
                <Separator className="my-6" />
                {renderTtsPanel('note', 'Your Note TTS Settings', yourNoteTtsSettings)}
            </div>

            {favoriteNotes.length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-2"><Info className="h-5 w-5" /> Your note favorites list is empty. In the reader, select text, add a note, and then save it to favorites.</p>
            ) : (
              <ul className="space-y-4">
                {favoriteNotes.map(item => {
                  const isCurrentlySpeakingThisItem = speakingItemId === item.id;
                  const isCurrentlyPaused = pausedItemId === item.id;
                  let buttonIcon = <Play className="mr-1.5 h-4 w-4" />;
                  let buttonText = "Play";
                  if (isCurrentlySpeakingThisItem) {
                    if (isCurrentlyPaused) {
                      buttonIcon = <Play className="mr-1.5 h-4 w-4" />;
                      buttonText = "Resume";
                    } else {
                      buttonIcon = <Pause className="mr-1.5 h-4 w-4" />;
                      buttonText = "Pause";
                    }
                  }
                  if (isLoadingTTS && isCurrentlySpeakingThisItem && !isCurrentlyPaused) {
                    buttonIcon = <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />;
                    buttonText = "Loading...";
                  }
                  const hasContentToPlay = item.annotation.targetText || item.annotation.note;

                  const originalTextSegments = useMemo(() => {
                    if (!item.annotation.targetText) return [];
                    const parts = item.annotation.targetText.split(PUNCTUATION_REGEX_FOR_SPLIT);
                    const segments = [];
                    for (let i = 0; i < parts.length; i += 2) {
                        const text = parts[i];
                        const delimiter = parts[i + 1] || '';
                        if (text || delimiter) segments.push(text + delimiter);
                    }
                    return segments;
                  }, [item.annotation.targetText]);

                  const noteTextSegments = useMemo(() => {
                      if (!item.annotation.note) return [];
                      const parts = item.annotation.note.split(PUNCTUATION_REGEX_FOR_SPLIT);
                      const segments = [];
                      for (let i = 0; i < parts.length; i += 2) {
                          const text = parts[i];
                          const delimiter = parts[i + 1] || '';
                          if (text || delimiter) segments.push(text + delimiter);
                      }
                      return segments;
                  }, [item.annotation.note]);

                  return (
                    <li key={item.id} className="p-4 border rounded-md flex flex-col justify-between gap-4 bg-card hover:shadow-md transition-shadow">
                      <div className="flex-grow space-y-3 w-full">
                          <div className="p-3 bg-muted/50 rounded-md">
                              <p className="text-xs text-muted-foreground mb-1">Original Text:</p>
                              <p className={cn("text-sm italic", !item.annotation.targetText && "text-muted-foreground")}>
                                <HighlightableText 
                                  text={item.annotation.targetText || ''}
                                  isSpeaking={isCurrentlySpeakingThisItem && currentlySpeakingPart === 'original'}
                                  highlightedSegmentIndex={highlightedSegmentIndex}
                                  segments={originalTextSegments}
                                />
                              </p>
                          </div>

                          <div className="p-3 bg-background rounded-md border">
                               <p className="text-xs text-muted-foreground mb-1">Your Note:</p>
                              <p className={cn("text-sm whitespace-pre-wrap", !item.annotation.note && "italic text-muted-foreground")}>
                                <HighlightableText 
                                    text={item.annotation.note || ''}
                                    isSpeaking={isCurrentlySpeakingThisItem && currentlySpeakingPart === 'note'}
                                    highlightedSegmentIndex={highlightedSegmentIndex}
                                    segments={noteTextSegments}
                                  />
                              </p>
                          </div>
                        
                          {item.annotation.imageDataUrl && (
                              <div className="p-2 border rounded-md">
                                  <p className="text-xs text-muted-foreground mb-2">Attached Image:</p>
                                  <div className="relative w-full max-w-xs">
                                       <NextImage src={item.annotation.imageDataUrl} alt="Annotation attachment" width={300} height={200} className="rounded-md object-contain" />
                                  </div>
                              </div>
                          )}
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between pt-3 border-t">
                           <p className="text-xs text-muted-foreground">
                            {item.sourceDocumentName && <span className="flex items-center gap-1"><FileText className="h-3 w-3"/> From: {item.sourceDocumentName} | </span>}
                            Favorited: {format(new Date(item.favoritedAt), "MMM d, yyyy HH:mm")}
                          </p>
                          <div className="flex gap-2 self-end sm:self-center">
                            <Button 
                              size="sm" 
                              variant={isCurrentlySpeakingThisItem && !isCurrentlyPaused ? "outline" : "default"}
                              onClick={() => handlePlayPauseNote(item)} 
                              disabled={(isLoadingTTS && !isCurrentlySpeakingThisItem) || !hasContentToPlay}
                              className="w-[100px]"
                              title={hasContentToPlay ? "Play/Pause Note" : "No text in note to play"}
                              >
                              {buttonIcon} {buttonText}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setNoteToDelete(item)} aria-label="Delete Note Favorite" disabled={isLoadingTTS && isCurrentlySpeakingThisItem}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
          {favoriteNotes.length > 0 && (
            <CardFooter>
              <p className="text-xs text-muted-foreground">Your note favorites are stored in your browser's local storage.</p>
            </CardFooter>
          )}
        </Card>
      </div>
      
      <AlertDialog open={!!noteToDelete} onOpenChange={(isOpen) => !isOpen && setNoteToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete this note favorite. The original annotation in the document will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function NotesFavoritesPage() {
    return (
        <AuthGuard>
            <NotesFavoritesPageContent />
        </AuthGuard>
    );
}
