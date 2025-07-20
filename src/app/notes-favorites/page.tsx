
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Trash2, Info, NotebookText, FileText, Play, Pause, Loader2, Smartphone, Cloud as CloudIcon, Star, Repeat1, ListOrdered, SkipBack, SkipForward } from 'lucide-react';
import * as LocalStorage from '@/lib/localStorageService';
import type { NoteFavoriteItem, TTSVoice, TTSSettings } from '@/types';
import { format } from 'date-fns';
import { AuthGuard } from '@/components/auth/AuthGuard';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { usePlayback } from '@/components/player/PlaybackProvider';


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

const HighlightableText: React.FC<{
  text: string;
  isSpeaking: boolean;
  highlightedText: string;
}> = ({ text, isSpeaking, highlightedText }) => {
    if (!isSpeaking || !text) {
        return <>{text ? `"${text}"` : "No original text."}</>;
    }

    const index = text.indexOf(highlightedText);
    if (index === -1) {
        return <>{text ? `"${text}"` : "No original text."}</>;
    }

    const preText = text.substring(0, index);
    const postText = text.substring(index + highlightedText.length);

    return (
        <>
        &quot;{preText}
        <span className="text-primary">{highlightedText}</span>
        {postText}&quot;
        </>
    );
};


function NotesFavoritesPageContent() {
  const { toast } = useToast();
  const [favoriteNotes, setFavoriteNotes] = useState<NoteFavoriteItem[]>([]);
  const [noteToDelete, setNoteToDelete] = useState<NoteFavoriteItem | null>(null);
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
    originalTextTtsSettings,
    setOriginalTextTtsSettings,
    yourNoteTtsSettings,
    setYourNoteTtsSettings,
    hasNext,
    hasPrevious,
  } = usePlayback();


  // Load initial settings and favorite items
  useEffect(() => {
    setFavoriteNotes(LocalStorage.loadNoteFavorites());
    setPlaybackMode(LocalStorage.loadNotesPlaybackMode());

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
            if (edgeTTSLanguageVoices[defaultLocale].voices.length > 0) {
              merged.cloudVoiceId = edgeTTSLanguageVoices[defaultLocale].voices[0].id;
            }
        }
        setter(merged);
    };

    loadAndSetSettings(LocalStorage.loadOriginalTextTTSSettings, setOriginalTextTtsSettings);
    loadAndSetSettings(LocalStorage.loadYourNoteTTSSettings, setYourNoteTtsSettings);
  }, [setPlaybackMode, setOriginalTextTtsSettings, setYourNoteTtsSettings]);

  // Save TTS settings to LocalStorage whenever they change
  useEffect(() => {
    LocalStorage.saveOriginalTextTTSSettings(originalTextTtsSettings);
  }, [originalTextTtsSettings]);
  useEffect(() => {
    LocalStorage.saveYourNoteTTSSettings(yourNoteTtsSettings);
  }, [yourNoteTtsSettings]);
  useEffect(() => {
      LocalStorage.saveNotesPlaybackMode(playbackMode);
  }, [playbackMode]);


  const handlePlayPauseNote = (item: NoteFavoriteItem) => {
    if (currentItem?.item.id === item.id && currentItem?.type === 'note_favorite') {
        if (isPaused) {
            resume();
        } else if (isPlaying) {
            pause();
        }
    } else {
        const fullPlaylist = favoriteNotes.map(note => ({ type: 'note_favorite' as const, item: note }));
        const startIndex = favoriteNotes.findIndex(note => note.id === item.id);
        play({ type: 'note_favorite', item }, fullPlaylist, startIndex);
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

  const performDelete = () => {
    if (!noteToDelete) return;
    if (currentItem?.item.id === noteToDelete.id) stop();
    LocalStorage.deleteNoteFavorite(noteToDelete.id);
    setFavoriteNotes(prev => prev.filter(item => item.id !== noteToDelete.id));
    toast({ title: "Note Favorite Removed" });
    setNoteToDelete(null);
  };
  
  const handleSettingChange = (
      panel: 'original' | 'note',
      key: keyof TTSSettings,
      value: any
  ) => {
      stop();
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

  const handleGlobalPlayPause = () => {
    if (isPlaying) {
      if (isPaused) {
        resume();
      } else {
        pause();
      }
    } else if (playlist.length > 0) {
        play(playlist[0], playlist, 0);
    } else if (favoriteNotes.length > 0) {
      handlePlayPauseNote(favoriteNotes[0]);
    }
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
                <Select value={settings.engine} onValueChange={(v) => handlePanelChange('engine', v as 'local' | 'cloud')} disabled={isPlaying}>
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
                    disabled={isPlaying || availableVoices.length === 0}
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
                    <Select value={settings.language} onValueChange={(v) => handlePanelChange('language', v as string)} disabled={isPlaying}>
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
                    <Select value={settings.cloudVoiceId || ""} onValueChange={(v) => handlePanelChange('cloudVoiceId', v)} disabled={isPlaying || !settings.language}>
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
            <Slider id={`${panelType}-tts-rate`} min={0.5} max={2} step={0.1} value={[settings.rate]} onValueChange={([v]) => handlePanelChange('rate', v)} disabled={isPlaying}/>
        </div>
        <div className="space-y-2">
            <Label htmlFor={`${panelType}-tts-pitch`}>Pitch: {settings.pitch.toFixed(1)}</Label>
            <Slider id={`${panelType}-tts-pitch`} min={0} max={2} step={0.1} value={[settings.pitch]} onValueChange={([v]) => handlePanelChange('pitch', v)} disabled={isPlaying}/>
        </div>
      </div>
    );
  };


  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><NotebookText className="text-primary" /> My Note Favorites</CardTitle>
          <CardDescription>Your saved annotations. Click to review, play or delete.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 p-4 border rounded-md bg-muted/20">
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
                    <Button variant="ghost" size="icon" onClick={handleGlobalPlayPause} disabled={isLoading || favoriteNotes.length === 0}>
                    {isLoading ? <Loader2 className="h-6 w-6 animate-spin"/> : isPlaying && !isPaused ? <Pause className="h-6 w-6"/> : <Play className="h-6 w-6"/>}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={next} disabled={!hasNext() || isLoading}><SkipForward className="h-5 w-5"/></Button>
                </div>
              <Separator className="my-6" />
              {renderTtsPanel('original', 'Original Text TTS Settings', originalTextTtsSettings)}
              <Separator className="my-6" />
              {renderTtsPanel('note', 'Your Note TTS Settings', yourNoteTtsSettings)}
          </div>

          {favoriteNotes.length === 0 ? (
            <p className="text-muted-foreground flex items-center gap-2"><Info className="h-5 w-5" /> Your note favorites list is empty. In the reader, select text, add a note, and then save it to favorites.</p>
          ) : (
            <ul className="space-y-4">
              {favoriteNotes.map(item => {
                const isCurrentlyPlayingThisItem = currentItem?.item.id === item.id;
                let buttonIcon = <Play className="mr-1.5 h-4 w-4" />;
                let buttonText = "Play";
                if (isCurrentlyPlayingThisItem) {
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
                const hasContentToPlay = item.annotation.targetText || item.annotation.note;

                return (
                  <li key={item.id} className="p-4 border rounded-md flex flex-col justify-between gap-4 bg-card hover:shadow-md transition-shadow">
                    <div className="flex-grow space-y-3 w-full">
                        <div className="p-3 bg-muted/50 rounded-md">
                            <p className="text-xs text-muted-foreground mb-1">Original Text:</p>
                            <p className={cn("text-sm italic", !item.annotation.targetText && "text-muted-foreground")}>
                              <HighlightableText
                                text={item.annotation.targetText || ''}
                                isSpeaking={isCurrentlyPlayingThisItem && currentItem?.type === 'note_favorite'}
                                highlightedText={currentText}
                              />
                            </p>
                        </div>

                        <div className="p-3 bg-background rounded-md border">
                             <p className="text-xs text-muted-foreground mb-1">Your Note:</p>
                            <p className={cn("text-sm whitespace-pre-wrap", !item.annotation.note && "italic text-muted-foreground")}>
                              <HighlightableText
                                  text={item.annotation.note || ''}
                                  isSpeaking={isCurrentlyPlayingThisItem && currentItem?.type === 'note_favorite'}
                                  highlightedText={currentText}
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
                            variant={isCurrentlyPlayingThisItem && !isPaused ? "outline" : "default"}
                            onClick={() => handlePlayPauseNote(item)} 
                            disabled={(isLoading && !isCurrentlyPlayingThisItem) || !hasContentToPlay}
                            className="w-[100px]"
                            title={hasContentToPlay ? "Play/Pause Note" : "No text in note to play"}
                            >
                            {buttonIcon} {buttonText}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setNoteToDelete(item)} aria-label="Delete Note Favorite" disabled={isLoading && isCurrentlyPlayingThisItem}>
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
    </div>
  );
}

export default function NotesFavoritesPage() {
    return (
        <AuthGuard>
            <NotesFavoritesPageContent />
        </AuthGuard>
    );
}
