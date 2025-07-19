
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
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

function NotesFavoritesPageContent() {
  const { toast } = useToast();
  const [favoriteNotes, setFavoriteNotes] = useState<NoteFavoriteItem[]>([]);
  const [noteToDelete, setNoteToDelete] = useState<NoteFavoriteItem | null>(null);

  const [isLoadingTTS, setIsLoadingTTS] = useState(false);
  const [speakingItemId, setSpeakingItemId] = useState<string | null>(null);
  const [pausedItemId, setPausedItemId] = useState<string | null>(null);
  
  const [ttsSettings, setTtsSettings] = useState<TTSSettings>(LocalStorage.defaultTTSSettings);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Load initial settings and favorite items
  useEffect(() => {
    setFavoriteNotes(LocalStorage.loadNoteFavorites());
    const loadedSettings = LocalStorage.loadTTSSettings();
    setTtsSettings(prevGlobalDefaults => {
        const merged = {
            ...prevGlobalDefaults, 
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
        return merged;
    });
  }, []);

  // Save TTS settings to LocalStorage whenever they change
  useEffect(() => {
    LocalStorage.saveTTSSettings(ttsSettings);
  }, [ttsSettings]);
  
  const stopSpeechGlobal = useCallback((resetUIState = true) => {
    if (ttsSettings.engine === 'local' && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    } else if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      if (audioPlayerRef.current.src && audioPlayerRef.current.readyState >= HTMLMediaElement.HAVE_METADATA) {
        try { audioPlayerRef.current.currentTime = 0; } catch (e) { /* ignore */ }
      }
    }
    if (utteranceRef.current) {
      utteranceRef.current.onend = null;
      utteranceRef.current.onerror = null;
      utteranceRef.current = null;
    }
    if (resetUIState) {
      setIsLoadingTTS(false);
      setSpeakingItemId(null);
      setPausedItemId(null);
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

  // Effect to select/update default voice based on language for LOCAL engine
  useEffect(() => {
    if (ttsSettings.engine !== 'local' || availableVoices.length === 0) return;

    let desiredVoiceURI: string | undefined = ttsSettings.voiceURI;
    let desiredLanguage: string = ttsSettings.language;
    let settingsNeedUpdate = false;

    const currentVoice = availableVoices.find(v => v.voiceURI === ttsSettings.voiceURI);

    if (!currentVoice) {
      const defaultVoice =
          availableVoices.find((v) => v.lang === desiredLanguage && v.default) ||
          availableVoices.find((v) => v.lang === desiredLanguage) ||
          availableVoices.find((v) => v.default && v.lang) ||
          availableVoices[0];

      if (defaultVoice && defaultVoice.lang) {
          desiredVoiceURI = defaultVoice.voiceURI;
          desiredLanguage = defaultVoice.lang;
          settingsNeedUpdate = true;
      }
    }

    if (settingsNeedUpdate) {
        setTtsSettings(prevSettings => ({
            ...prevSettings,
            voiceURI: desiredVoiceURI,
            language: desiredLanguage,
        }));
    }
  }, [availableVoices, ttsSettings.language, ttsSettings.voiceURI, ttsSettings.engine]);


  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;
    const handleAudioEnded = () => stopSpeechGlobal(true);
    const handleAudioPlaying = () => {
      if (ttsSettings.engine === 'cloud' && speakingItemId) setIsLoadingTTS(false);
    };
    const handleAudioError = () => {
      toast({variant: "destructive", title: "Audio Error", description: "Failed to play audio."});
      stopSpeechGlobal(true);
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
  }, [ttsSettings.engine, speakingItemId, toast, stopSpeechGlobal]);

  const handlePlayPauseNote = async (item: NoteFavoriteItem) => {
    const textToPlay = item.annotation.note;
    if (!textToPlay) {
      toast({ variant: 'destructive', title: 'No Text', description: 'This note has no text to read.' });
      return;
    }

    if (speakingItemId === item.id) { 
      if (pausedItemId === item.id) { 
        if (ttsSettings.engine === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
          if(window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
            setPausedItemId(null);
          } else {
            stopSpeechGlobal(true);
          }
        } else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current?.paused) {
          audioPlayerRef.current.play().catch(() => stopSpeechGlobal(true));
          setPausedItemId(null);
        }
      } else { 
        if (ttsSettings.engine === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
          window.speechSynthesis.pause();
          setPausedItemId(item.id);
        } else if (ttsSettings.engine === 'cloud' && audioPlayerRef.current && !audioPlayerRef.current.paused) {
          audioPlayerRef.current.pause();
          setPausedItemId(item.id);
        }
      }
    } else { 
      stopSpeechGlobal(false);
      setIsLoadingTTS(true);
      setSpeakingItemId(item.id);
      setPausedItemId(null);

      if (ttsSettings.engine === 'local') {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
          toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
          stopSpeechGlobal(true); return;
        }
        const utterance = new SpeechSynthesisUtterance(textToPlay);
        utterance.lang = ttsSettings.language;
        utterance.pitch = ttsSettings.pitch;
        utterance.rate = ttsSettings.rate;
        const voice = availableVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
        if (voice) utterance.voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === voice.voiceURI);
        
        utterance.onend = () => { if(utteranceRef.current === utterance) stopSpeechGlobal(true); };
        utterance.onerror = (event) => {
            if(utteranceRef.current === utterance) {
                toast({ variant: "destructive", title: "TTS Error", description: event.error || "Speech failed." });
                stopSpeechGlobal(true);
            }
        };
        utteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
        setIsLoadingTTS(false);
      } else { 
        try {
          const result = await getCloudSpeech(textToPlay, ttsSettings.language, ttsSettings.cloudVoiceId);
          if ('audioUrl' in result && audioPlayerRef.current) {
            audioPlayerRef.current.src = result.audioUrl;
            await audioPlayerRef.current.play();
          } else if ('error' in result) {
            toast({ variant: "destructive", title: "Cloud TTS Error", description: result.error });
            stopSpeechGlobal(true);
          }
        } catch (error: any) {
          toast({ variant: "destructive", title: "Cloud TTS Failed", description: error.message });
          stopSpeechGlobal(true);
        }
      }
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
  
  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    stopSpeechGlobal(true);
    
    setTtsSettings(prevSettings => {
        let newSettings = { ...prevSettings, [key]: value };

        if (key === 'engine') {
            newSettings.type = value as 'local' | 'cloud';
            if (value === 'cloud') {
                const currentLang = newSettings.language;
                const cloudLangData = edgeTTSLanguageVoices[currentLang];
                if (!cloudLangData) {
                    const defaultLocale = 'en-US';
                    newSettings.language = defaultLocale;
                    newSettings.cloudVoiceId = edgeTTSLanguageVoices[defaultLocale].voices[0].id;
                } else if (!newSettings.cloudVoiceId?.startsWith(currentLang)) {
                    newSettings.cloudVoiceId = cloudLangData.voices[0].id;
                }
            } else if (value === 'local') {
                const currentVoice = availableVoices.find(v => v.voiceURI === newSettings.voiceURI);
                if (!currentVoice) {
                    const defaultVoice = availableVoices.find(v => v.default) || availableVoices[0];
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
                  <h3 className="text-lg font-medium mb-3">Global TTS Settings for Notes</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                      <div>
                          <Label htmlFor="fav-tts-engine">TTS Engine</Label>
                          <Select value={ttsSettings.engine} onValueChange={(v) => handleSettingChange('engine', v as 'local' | 'cloud')} disabled={!!speakingItemId && !pausedItemId}>
                              <SelectTrigger id="fav-tts-engine"><SelectValue /></SelectTrigger>
                              <SelectContent>
                              <SelectItem value="local"><div className="flex items-center gap-1"><Smartphone className="h-4 w-4" /> Local</div></SelectItem>
                              <SelectItem value="cloud"><div className="flex items-center gap-1"><CloudIcon className="h-4 w-4"/> Cloud</div></SelectItem>
                              </SelectContent>
                          </Select>
                      </div>
                  </div>

                  {ttsSettings.engine === 'local' && (
                      <div className="mb-3">
                          <Label htmlFor="fav-tts-voice">Voice (Local)</Label>
                          <Select
                              value={ttsSettings.voiceURI || ""}
                              onValueChange={(v) => handleSettingChange('voiceURI', v)}
                              disabled={!!speakingItemId && !pausedItemId || availableVoices.length === 0}
                          >
                              <SelectTrigger id="fav-tts-voice"><SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No local voices found"} /></SelectTrigger>
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

                  {ttsSettings.engine === 'cloud' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                          <div>
                              <Label htmlFor="fav-cloud-tts-language">Language (Cloud)</Label>
                              <Select value={ttsSettings.language} onValueChange={(v) => handleSettingChange('language', v as string)} disabled={!!speakingItemId && !pausedItemId}>
                                  <SelectTrigger id="fav-cloud-tts-language"><SelectValue placeholder="Select a language" /></SelectTrigger>
                                  <SelectContent className="max-h-60">
                                      {Object.entries(edgeTTSLanguageVoices).map(([locale, { language }]) => (
                                          <SelectItem key={locale} value={locale}>{language} ({locale})</SelectItem>
                                      ))}
                                  </SelectContent>
                              </Select>
                          </div>
                          <div>
                              <Label htmlFor="fav-cloud-tts-voice">Voice (Cloud)</Label>
                              <Select value={ttsSettings.cloudVoiceId || ""} onValueChange={(v) => handleSettingChange('cloudVoiceId', v)} disabled={!!speakingItemId && !pausedItemId || !ttsSettings.language}>
                                  <SelectTrigger id="fav-cloud-tts-voice"><SelectValue placeholder="Select a voice" /></SelectTrigger>
                                  <SelectContent className="max-h-60">
                                      {(edgeTTSLanguageVoices[ttsSettings.language]?.voices || []).map(voice => (
                                          <SelectItem key={voice.id} value={voice.id}>{voice.name}</SelectItem>
                                      ))}
                                  </SelectContent>
                              </Select>
                          </div>
                      </div>
                  )}

                  <div className="space-y-2 mb-3">
                      <Label htmlFor="fav-tts-rate">Rate: {ttsSettings.rate.toFixed(1)}</Label>
                      <Slider id="fav-tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={!!speakingItemId && !pausedItemId}/>
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="fav-tts-pitch">Pitch: {ttsSettings.pitch.toFixed(1)}</Label>
                      <Slider id="fav-tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={!!speakingItemId && !pausedItemId}/>
                  </div>
            </div>

            {favoriteNotes.length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-2"><Info className="h-5 w-5" /> Your note favorites list is empty. In the reader, select text, add a note, and then save it to favorites.</p>
            ) : (
              <ul className="space-y-4">
                {favoriteNotes.map(item => {
                  const isCurrentlySpeaking = speakingItemId === item.id;
                  const isCurrentlyPaused = pausedItemId === item.id;
                  let buttonIcon = <Play className="mr-1.5 h-4 w-4" />;
                  let buttonText = "Play";
                  if (isCurrentlySpeaking) {
                    if (isCurrentlyPaused) {
                      buttonIcon = <Play className="mr-1.5 h-4 w-4" />;
                      buttonText = "Resume";
                    } else {
                      buttonIcon = <Pause className="mr-1.5 h-4 w-4" />;
                      buttonText = "Pause";
                    }
                  }
                  if (isLoadingTTS && isCurrentlySpeaking && !isCurrentlyPaused) {
                    buttonIcon = <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />;
                    buttonText = "Loading...";
                  }

                  return (
                    <li key={item.id} className="p-4 border rounded-md flex flex-col justify-between gap-4 bg-card hover:shadow-md transition-shadow">
                      <div className="flex-grow space-y-3 w-full">
                          <div className="p-3 bg-muted/50 rounded-md">
                              <p className="text-xs text-muted-foreground mb-1">Original Text:</p>
                              <p className="text-sm italic">&quot;{item.annotation.targetText}&quot;</p>
                          </div>

                          <div className={cn("p-3 bg-background rounded-md border", (isCurrentlySpeaking || isCurrentlyPaused) && "border-green-500 ring-2 ring-green-500/50")}>
                               <p className="text-xs text-muted-foreground mb-1">Your Note:</p>
                              <p className={cn("text-sm whitespace-pre-wrap", !item.annotation.note && "italic text-muted-foreground")}>
                                  {item.annotation.note || "No text note provided."}
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
                              variant={isCurrentlySpeaking && !isCurrentlyPaused ? "outline" : "default"}
                              onClick={() => handlePlayPauseNote(item)} 
                              disabled={(isLoadingTTS && !isCurrentlySpeaking) || !item.annotation.note}
                              className="w-[100px]"
                              title={item.annotation.note ? "Play/Pause Note" : "No text in note to play"}
                              >
                              {buttonIcon} {buttonText}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setNoteToDelete(item)} aria-label="Delete Note Favorite" disabled={isLoadingTTS && isCurrentlySpeaking}>
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

      