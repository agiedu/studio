
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Play, Trash2, Loader2, Pause, Smartphone, Cloud as CloudIcon, Info, Star, Repeat1, ListOrdered, SkipBack, SkipForward } from 'lucide-react';
import * as LocalStorage from '@/lib/localStorageService';
import type { FavoriteItem, TTSVoice } from '@/types';
import { format } from 'date-fns';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { edgeTTSLanguageVoices } from '@/lib/edge-tts-voices';
import { cn } from '@/lib/utils';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { usePlayback } from '@/components/player/PlaybackProvider';
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


// Helper to group voices by language
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

function FavoritesPageContent() {
  const { toast } = useToast();
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [itemToDelete, setItemToDelete] = useState<FavoriteItem | null>(null);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);

  const {
    play,
    stop,
    pause,
    resume,
    next,
    previous,
    isPlaying,
    isPaused,
    isLoading,
    currentItem,
    currentText,
    playlist,
    playbackMode,
    setPlaybackMode,
    originalTextTtsSettings: ttsSettings,
    setOriginalTextTtsSettings: setTtsSettings,
    hasNext,
    hasPrevious
  } = usePlayback();


  // Load initial settings and favorite items
  useEffect(() => {
    setFavoriteItems(LocalStorage.loadFavoriteItems());
    setPlaybackMode(LocalStorage.loadFavoritesPlaybackMode());

    const loadedSettings = LocalStorage.loadTTSSettings();
    setTtsSettings(prevGlobalDefaults => {
        const merged = {
            ...prevGlobalDefaults,
            ...loadedSettings,
            type: loadedSettings.type || 'local',
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
  }, [setPlaybackMode, setTtsSettings]);

  // Save TTS settings to LocalStorage whenever they change
  useEffect(() => {
    LocalStorage.saveTTSSettings(ttsSettings);
  }, [ttsSettings]);
  
  useEffect(() => {
    LocalStorage.saveFavoritesPlaybackMode(playbackMode);
  }, [playbackMode]);
  
  const handlePlayPauseFavorite = (item: FavoriteItem) => {
    if (currentItem?.item.id === item.id && currentItem?.type === 'favorite') {
        if (isPaused) {
            resume();
        } else if (isPlaying) {
            pause();
        }
    } else {
        const fullPlaylist = favoriteItems.map(fav => ({ type: 'favorite' as const, item: fav }));
        const startIndex = favoriteItems.findIndex(fav => fav.id === item.id);
        play({ type: 'favorite', item }, fullPlaylist, startIndex);
    }
  };

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
    };
  }, [populateVoiceList]);

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
  }, [availableVoices, ttsSettings.language, ttsSettings.voiceURI, ttsSettings.engine, setTtsSettings]);
  
  const performDelete = () => {
    if (!itemToDelete) return;
    if (currentItem?.item.id === itemToDelete.id) stop();
    LocalStorage.deleteFavoriteItem(itemToDelete.id);
    setFavoriteItems(prev => prev.filter(item => item.id !== itemToDelete.id));
    toast({ title: "Favorite Removed" });
    setItemToDelete(null);
  };
  
  const handleSettingChange = (key: any, value: any) => {
    stop();
    setTtsSettings(prevSettings => {
        let newSettings:any = { ...prevSettings, [key]: value };

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

  const handleGlobalPlayPause = () => {
    if (isPlaying) {
      if (isPaused) {
        resume();
      } else {
        pause();
      }
    } else if (playlist.length > 0) {
      play(playlist[0], playlist, 0);
    } else if (favoriteItems.length > 0) {
      handlePlayPauseFavorite(favoriteItems[0]);
    }
  };

  const groupedLocalVoices = groupVoicesByLanguage(availableVoices);

  return (
    <>
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Star className="text-primary" /> My Favorites</CardTitle>
            <CardDescription>Your saved text snippets. Click to play or delete.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6 p-4 border rounded-md bg-muted/20">
                  <h3 className="text-lg font-medium mb-3">Global TTS Settings for Favorites</h3>
                  <div className="mb-4">
                      <Label className="font-medium text-sm">Playback Mode</Label>
                      <RadioGroup
                        value={playbackMode}
                        onValueChange={(v) => {
                          setPlaybackMode(v as 'default' | 'loop-single' | 'sequential');
                        }}
                        className="flex items-center gap-4 mt-2"
                        disabled={isPlaying}
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="default" id="mode-default" />
                          <Label htmlFor="mode-default" className="flex items-center gap-1 cursor-pointer"><Play className="h-4 w-4"/>Default</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="loop-single" id="mode-loop" />
                          <Label htmlFor="mode-loop" className="flex items-center gap-1 cursor-pointer"><Repeat1 className="h-4 w-4"/>Loop Single</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="sequential" id="mode-sequential" />
                          <Label htmlFor="mode-sequential" className="flex items-center gap-1 cursor-pointer"><ListOrdered className="h-4 w-4"/>Sequential</Label>
                        </div>
                      </RadioGroup>
                  </div>
                  <div className="flex items-center justify-center gap-4 my-4 p-2 rounded-lg bg-muted/50">
                     <Button variant="ghost" size="icon" onClick={previous} disabled={!hasPrevious() || isLoading}><SkipBack className="h-5 w-5"/></Button>
                     <Button variant="ghost" size="icon" onClick={handleGlobalPlayPause} disabled={isLoading || favoriteItems.length === 0}>
                        {isLoading ? <Loader2 className="h-6 w-6 animate-spin"/> : isPlaying && !isPaused ? <Pause className="h-6 w-6"/> : <Play className="h-6 w-6"/>}
                     </Button>
                     <Button variant="ghost" size="icon" onClick={next} disabled={!hasNext() || isLoading}><SkipForward className="h-5 w-5"/></Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                      <div>
                          <Label htmlFor="fav-tts-engine">TTS Engine</Label>
                          <Select value={ttsSettings.engine} onValueChange={(v) => handleSettingChange('engine', v as 'local' | 'cloud')} disabled={isPlaying}>
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
                              disabled={isPlaying || availableVoices.length === 0}
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
                              <Select value={ttsSettings.language} onValueChange={(v) => handleSettingChange('language', v as string)} disabled={isPlaying}>
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
                              <Select value={ttsSettings.cloudVoiceId || ""} onValueChange={(v) => handleSettingChange('cloudVoiceId', v)} disabled={isPlaying || !ttsSettings.language}>
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
                      <Slider id="fav-tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={isPlaying}/>
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="fav-tts-pitch">Pitch: {ttsSettings.pitch.toFixed(1)}</Label>
                      <Slider id="fav-tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={isPlaying}/>
                  </div>
            </div>

            {favoriteItems.length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-2"><Info className="h-5 w-5" /> Your favorites list is empty. Select text in the reader and click "Favorite Selected Text" to add items.</p>
            ) : (
              <ul className="space-y-3">
                {favoriteItems.map(item => {
                  const isCurrentlyPlaying = currentItem?.item.id === item.id && currentItem?.type === 'favorite';
                  let buttonIcon = <Play className="mr-1.5 h-4 w-4" />;
                  let buttonText = "Play";
                  if (isCurrentlyPlaying) {
                    if (isLoading) {
                         buttonIcon = <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />;
                         buttonText = "Loading...";
                    } else if (isPaused) {
                      buttonIcon = <Play className="mr-1.5 h-4 w-4" />;
                      buttonText = "Resume";
                    } else {
                      buttonIcon = <Pause className="mr-1.5 h-4 w-4" />;
                      buttonText = "Pause";
                    }
                  }

                  return (
                    <li key={item.id} className="p-3 border rounded-md flex flex-col sm:flex-row justify-between items-start gap-2 bg-card hover:shadow-md transition-shadow">
                      <div className="flex-grow">
                        <p className="text-sm mb-1 whitespace-pre-wrap">
                          {isCurrentlyPlaying && currentText ?
                            <span className="text-primary">`{currentText}`</span>
                            :
                            `"${item.text}"`
                          }
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.sourceDocumentName && `From: ${item.sourceDocumentName} | `}
                          Added: {format(new Date(item.createdAt), "MMM d, yyyy HH:mm")}
                        </p>
                      </div>
                      <div className="flex gap-2 mt-2 sm:mt-0 sm:items-center flex-shrink-0">
                        <Button 
                          size="sm" 
                          variant={isCurrentlyPlaying && !isPaused ? "outline" : "default"}
                          onClick={() => handlePlayPauseFavorite(item)} 
                          disabled={isLoading && !isCurrentlyPlaying}
                          className="w-[100px]"
                          >
                          {buttonIcon} {buttonText}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setItemToDelete(item)} disabled={isLoading && isCurrentlyPlaying} aria-label="Delete Favorite">
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
      <AlertDialog open={!!itemToDelete} onOpenChange={(isOpen) => !isOpen && setItemToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete this favorite.
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

export default function FavoritesPage() {
    return (
        <AuthGuard>
            <FavoritesPageContent />
        </AuthGuard>
    );
}
