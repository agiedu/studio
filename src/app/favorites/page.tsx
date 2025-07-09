
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Play, Trash2, Loader2, Pause, Smartphone, Cloud as CloudIcon, Info, Star } from 'lucide-react';
import * as LocalStorage from '@/lib/localStorageService';
import type { FavoriteItem, TTSVoice } from '@/types';
import { format } from 'date-fns';
import { getCloudSpeech } from '@/app/actions';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { edgeTTSLanguageVoices } from '@/lib/edge-tts-voices';
import { cn } from '@/lib/utils';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AppHeader } from '@/components/app/AppHeader';


interface FavoritesTTSSettings {
  engine: 'local' | 'cloud';
  language: string; // for local, 'en-US'; for cloud, a locale like 'af-ZA'
  rate: number;
  pitch: number;
  voiceURI?: string; // for local
  cloudVoiceId?: string; // for cloud, e.g. 'af-ZA-AdriNeural'
  type?: 'local' | 'cloud'; 
}

function FavoritesPageContent() {
  const { toast } = useToast();
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [isLoadingTTS, setIsLoadingTTS] = useState(false);
  const [speakingItemId, setSpeakingItemId] = useState<string | null>(null);
  const [pausedItemId, setPausedItemId] = useState<string | null>(null);
  
  const [ttsSettings, setTtsSettings] = useState<FavoritesTTSSettings>(LocalStorage.defaultTTSSettings as FavoritesTTSSettings);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Load initial settings and favorite items
  useEffect(() => {
    setFavoriteItems(LocalStorage.loadFavoriteItems());
    const loadedSettings = LocalStorage.loadTTSSettings();
    setTtsSettings(prevGlobalDefaults => {
        const merged = {
            ...prevGlobalDefaults, // Start with component defaults (rate, pitch if not in LS)
            ...loadedSettings,    // Override with anything from LS
            type: loadedSettings.type || 'local', // Ensure type is present
            engine: loadedSettings.engine || loadedSettings.type || 'local', // Ensure engine logic
        };

        // Set default cloud voice if not present and engine is cloud
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

    const currentLang = ttsSettings.language;
    const currentVoiceURI = ttsSettings.voiceURI;

    const currentVoiceIsValidForLanguage = availableVoices.some(
        (v) => v.voiceURI === currentVoiceURI && v.lang && v.lang.startsWith(currentLang.split('-')[0])
    );

    if (!currentVoiceURI || !currentVoiceIsValidForLanguage) {
        const defaultVoice =
            availableVoices.find((v) => v.lang === currentLang && v.default) ||
            availableVoices.find((v) => v.lang === currentLang) ||
            availableVoices.find((v) => v.lang && v.lang.startsWith(currentLang.split('-')[0]) && v.default) ||
            availableVoices.find((v) => v.lang && v.lang.startsWith(currentLang.split('-')[0])) ||
            availableVoices.find((v) => v.default && v.lang) ||
            availableVoices.find(v => v.lang) ||
            (availableVoices.length > 0 ? availableVoices[0] : undefined);

        if (defaultVoice && defaultVoice.lang) {
            desiredVoiceURI = defaultVoice.voiceURI;
            desiredLanguage = defaultVoice.lang;
        } else {
            desiredVoiceURI = undefined;
        }

        if (desiredVoiceURI !== ttsSettings.voiceURI || desiredLanguage !== ttsSettings.language) {
            settingsNeedUpdate = true;
        }

        if (settingsNeedUpdate) {
            setTtsSettings(prevSettings => ({
                ...prevSettings,
                voiceURI: desiredVoiceURI,
                language: desiredLanguage,
            }));
        }
    }
  }, [availableVoices, ttsSettings.language, ttsSettings.engine]);


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

  const handlePlayPauseFavorite = async (item: FavoriteItem) => {
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
        const utterance = new SpeechSynthesisUtterance(item.text);
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
          const result = await getCloudSpeech(item.text, ttsSettings.language, ttsSettings.cloudVoiceId);
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

  const handleDeleteFavorite = (itemId: string) => {
    if (speakingItemId === itemId) stopSpeechGlobal(true);
    LocalStorage.deleteFavoriteItem(itemId);
    setFavoriteItems(prev => prev.filter(item => item.id !== itemId));
    toast({ title: "Favorite Removed" });
  };
  
  const handleSettingChange = <K extends keyof FavoritesTTSSettings>(key: K, value: FavoritesTTSSettings[K]) => {
    stopSpeechGlobal(true);
    
    setTtsSettings(prevSettings => {
        const newSettings = { ...prevSettings, [key]: value };

        if (key === 'engine') {
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
        
        return newSettings;
    });
  };


  return (
    <>
      <AppHeader />
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Star className="text-primary" /> My Favorites</CardTitle>
            <CardDescription>Your saved text snippets. Click to play or delete.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6 p-4 border rounded-md bg-muted/20">
                  <h3 className="text-lg font-medium mb-3">Global TTS Settings for Favorites</h3>
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
                      {ttsSettings.engine === 'local' && (
                          <div>
                              <Label htmlFor="fav-tts-language">Language</Label>
                              <Input id="fav-tts-language" value={ttsSettings.language} onChange={(e) => handleSettingChange('language', e.target.value)} disabled={!!speakingItemId && !pausedItemId || availableVoices.length === 0} />
                          </div>
                      )}
                  </div>

                  {ttsSettings.engine === 'local' && (
                      <div className="mb-3">
                          <Label htmlFor="fav-tts-voice">Voice (Local)</Label>
                          <Select 
                              value={ttsSettings.voiceURI || ""} 
                              onValueChange={(v) => handleSettingChange('voiceURI', v)} 
                              disabled={!!speakingItemId && !pausedItemId || availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0}
                          >
                              <SelectTrigger id="fav-tts-voice"><SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No voices available"} /></SelectTrigger>
                              <SelectContent className="max-h-60">
                              {availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).map(voice => (
                                  <SelectItem key={voice.voiceURI || voice.name} value={voice.voiceURI}>{voice.name} ({voice.lang})</SelectItem>
                              ))}
                              {availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (
                                  <SelectItem value="no-voice-fav" disabled>{availableVoices.length > 0 ? "No voices for language" : "No local voices"}</SelectItem>
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

            {favoriteItems.length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-2"><Info className="h-5 w-5" /> Your favorites list is empty. Select text in the reader and click "Favorite Selected Text" to add items.</p>
            ) : (
              <ul className="space-y-3">
                {favoriteItems.map(item => {
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
                    <li key={item.id} className="p-3 border rounded-md flex flex-col sm:flex-row justify-between items-start gap-2 bg-card hover:shadow-md transition-shadow">
                      <div className="flex-grow">
                        <p className={cn(
                            "text-sm mb-1 whitespace-pre-wrap transition-colors",
                            (isCurrentlySpeaking || isCurrentlyPaused) && "text-green-600 dark:text-green-500"
                          )}>"{item.text}"</p>
                        <p className="text-xs text-muted-foreground">
                          {item.sourceDocumentName && `From: ${item.sourceDocumentName} | `}
                          Added: {format(new Date(item.createdAt), "MMM d, yyyy HH:mm")}
                        </p>
                      </div>
                      <div className="flex gap-2 mt-2 sm:mt-0 sm:items-center flex-shrink-0">
                        <Button 
                          size="sm" 
                          variant={isCurrentlySpeaking && !isCurrentlyPaused ? "outline" : "default"}
                          onClick={() => handlePlayPauseFavorite(item)} 
                          disabled={isLoadingTTS && !isCurrentlySpeaking}
                          className="w-[100px]"
                          >
                          {buttonIcon} {buttonText}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDeleteFavorite(item.id)} disabled={isLoadingTTS && isCurrentlySpeaking} aria-label="Delete Favorite">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
          {favoriteItems.length > 0 && (
            <CardFooter>
              <p className="text-xs text-muted-foreground">Your favorites are stored in your browser's local storage.</p>
            </CardFooter>
          )}
        </Card>
      </div>
    </>
  );
}

export default function FavoritesPage() {
    return (
        <AuthGuard>
            <FavoritesPageContent />
        </AuthGuard>
    );
}
