"use client";

import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import type { FavoriteItem, NoteFavoriteItem, TTSSettings } from '@/types';
import { getCloudSpeech } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';

const PUNCTUATION_REGEX_FOR_SPLIT = /([.,?!,。？！，、\n\r]+)/g;
const PUNCTUATION_REGEX_FOR_CLEANUP = /[.,?!,。？！，、\n\r"“„”'‘’`*_{}\[\]()#&@:;~<>/\\|\-—–^%$]/g;

type PlayableItem =
  | { type: 'favorite'; item: FavoriteItem }
  | { type: 'note_favorite'; item: NoteFavoriteItem };

type PlaybackMode = 'default' | 'loop-single' | 'sequential';

interface PlaybackContextType {
  isPlaying: boolean;
  isPaused: boolean;
  isLoading: boolean;
  currentItem: PlayableItem | null;
  playlist: PlayableItem[];
  currentText: string;
  play: (item?: PlayableItem, playlist?: PlayableItem[]) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  next: () => void;
  previous: () => void;
  hasNext: () => boolean;
  hasPrevious: () => boolean;
  playbackMode: PlaybackMode;
  setPlaybackMode: (mode: PlaybackMode) => void;
  originalTextTtsSettings: TTSSettings;
  setOriginalTextTtsSettings: (settings: TTSSettings) => void;
  yourNoteTtsSettings: TTSSettings;
  setYourNoteTtsSettings: (settings: TTSSettings) => void;
}

const PlaybackContext = createContext<PlaybackContextType | undefined>(undefined);

export const usePlayback = () => {
  const context = useContext(PlaybackContext);
  if (!context) {
    throw new Error('usePlayback must be used within a PlaybackProvider');
  }
  return context;
};

export const PlaybackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toast } = useToast();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentItem, setCurrentItem] = useState<PlayableItem | null>(null);
  const [playlist, setPlaylist] = useState<PlayableItem[]>([]);
  const [currentText, setCurrentText] = useState('');
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('default');

  const [originalTextTtsSettings, setOriginalTextTtsSettings] = useState<TTSSettings>({ type: 'local', language: 'en-US', rate: 1, pitch: 1, engine: 'local' });
  const [yourNoteTtsSettings, setYourNoteTtsSettings] = useState<TTSSettings>({ type: 'local', language: 'en-US', rate: 1, pitch: 1, engine: 'local' });
  
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechQueueRef = useRef<{ text: string; settings: TTSSettings; part?: 'original' | 'note' }[]>([]);
  const segmentIndexRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  },[]);


  const acquireWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          console.log('Screen Wake Lock was released');
        });
        console.log('Screen Wake Lock is active');
      } catch (err: any) {
        console.error(`${err.name}, ${err.message}`);
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  };


  const stop = useCallback(() => {
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
      if (audioPlayerRef.current.src) {
        audioPlayerRef.current.src = "";
      }
    }
    if (isMountedRef.current) {
        setIsPlaying(false);
        setIsPaused(false);
        setIsLoading(false);
        setCurrentItem(null);
        setCurrentText('');
    }
    releaseWakeLock();
    if (navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'none';
    }
  }, []);

  const onPlaybackEnd = useCallback(() => {
    const findNextItem = (currentItemId: string): PlayableItem | null => {
      const currentIndex = playlist.findIndex(p => p.item.id === currentItemId);
      if (currentIndex > -1 && currentIndex < playlist.length - 1) {
        return playlist[currentIndex + 1];
      }
      return null;
    };
  
    if (!currentItem) {
      stop();
      return;
    }
  
    switch (playbackMode) {
      case 'loop-single':
        setTimeout(() => play(currentItem, playlist), 100);
        break;
      case 'sequential':
        const nextItem = findNextItem(currentItem.item.id);
        if (nextItem) {
          setTimeout(() => play(nextItem, playlist), 100);
        } else {
          stop();
        }
        break;
      case 'default':
      default:
        stop();
        break;
    }
  }, [currentItem, playlist, playbackMode, stop]);


  const speakNextSegment = useCallback(async () => {
    if (!isSpeakingRef.current || speechQueueRef.current.length === 0) {
      if (isMountedRef.current) {
        onPlaybackEnd();
      }
      return;
    }

    const currentPart = speechQueueRef.current[0];
    if (segmentIndexRef.current >= (currentPart.text.match(PUNCTUATION_REGEX_FOR_SPLIT) || [currentPart.text]).filter(Boolean).length) {
      speechQueueRef.current.shift();
      segmentIndexRef.current = 0;
      speakNextSegment();
      return;
    }

    if (isMountedRef.current) setIsLoading(true);
    
    const segments = (currentPart.text.match(PUNCTUATION_REGEX_FOR_SPLIT) || [currentPart.text]).filter(Boolean);
    const segmentText = segments[segmentIndexRef.current];
    const cleanedText = segmentText.replace(PUNCTUATION_REGEX_FOR_CLEANUP, ' ').trim();

    if (isMountedRef.current) setCurrentText(cleanedText);

    if (navigator.mediaSession && currentItem) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: cleanedText,
          artist: currentItem.item.sourceDocumentName || 'MangaTalk',
        });
    }


    if (!cleanedText) {
      segmentIndexRef.current++;
      speakNextSegment();
      return;
    }
    
    if (currentPart.settings.engine === 'local') {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
        stop(); return;
      }
      const utterance = new SpeechSynthesisUtterance(cleanedText);
      utterance.lang = currentPart.settings.language;
      utterance.pitch = currentPart.settings.pitch;
      utterance.rate = currentPart.settings.rate;
      if (currentPart.settings.voiceURI) {
        const voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === currentPart.settings.voiceURI);
        if (voice) utterance.voice = voice;
      }
      
      utterance.onend = () => { if(utteranceRef.current === utterance) { segmentIndexRef.current++; speakNextSegment(); } };
      utterance.onerror = (event) => {
          if(utteranceRef.current === utterance) {
              toast({ variant: "destructive", title: "TTS Error", description: event.error || "Speech failed." });
              stop();
          }
      };
      utteranceRef.current = utterance;
      if (isMountedRef.current) setIsLoading(false);
      window.speechSynthesis.speak(utterance);
    } else {
      try {
        const result = await getCloudSpeech(cleanedText, currentPart.settings.language, currentPart.settings.cloudVoiceId);
        if (!isMountedRef.current || !isSpeakingRef.current) return;
        if ('audioUrl' in result && audioPlayerRef.current) {
          audioPlayerRef.current.src = result.audioUrl;
          await audioPlayerRef.current.play();
        } else if ('error' in result) {
          toast({ variant: "destructive", title: "Cloud TTS Error", description: result.error });
          stop();
        }
      } catch (error: any) {
        if (!isMountedRef.current) return;
        toast({ variant: "destructive", title: "Cloud TTS Failed", description: error.message });
        stop();
      }
    }
  }, [stop, toast, onPlaybackEnd, currentItem]);

  const play = useCallback((item?: PlayableItem, newPlaylist?: PlayableItem[]) => {
    const itemToPlay = item || (newPlaylist && newPlaylist.length > 0 ? newPlaylist[0] : null);
    if (!itemToPlay) return;

    stop();
    acquireWakeLock();
    if(isMountedRef.current) {
        setIsPlaying(true);
        setIsPaused(false);
        setCurrentItem(itemToPlay);
        if(newPlaylist) setPlaylist(newPlaylist);
        else if(item) setPlaylist([item]);
    }
    isSpeakingRef.current = true;
    segmentIndexRef.current = 0;
    speechQueueRef.current = [];
    
    if (itemToPlay.type === 'favorite') {
      speechQueueRef.current.push({ text: itemToPlay.item.text, settings: originalTextTtsSettings });
    } else if (itemToPlay.type === 'note_favorite') {
      if (itemToPlay.item.annotation.targetText) {
        speechQueueRef.current.push({ text: itemToPlay.item.annotation.targetText, settings: originalTextTtsSettings, part: 'original' });
      }
      if (itemToPlay.item.annotation.note) {
        speechQueueRef.current.push({ text: itemToPlay.item.annotation.note, settings: yourNoteTtsSettings, part: 'note' });
      }
    }

    if (speechQueueRef.current.length === 0) {
      toast({ variant: 'destructive', title: 'No Text', description: 'This item has no text to read.' });
      stop();
      return;
    }
    
    speakNextSegment();
  }, [stop, speakNextSegment, originalTextTtsSettings, yourNoteTtsSettings, toast]);

  const pause = useCallback(() => {
    if (!isSpeakingRef.current || !isMountedRef.current) return;
    setIsPaused(true);
    if (utteranceRef.current) {
        if(window.speechSynthesis.speaking) window.speechSynthesis.pause();
    } else if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
    }
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
    releaseWakeLock();
  }, []);

  const resume = useCallback(() => {
    if (!isSpeakingRef.current || !isMountedRef.current) return;
    setIsPaused(false);
    acquireWakeLock();
    if (utteranceRef.current) {
        if(window.speechSynthesis.paused) window.speechSynthesis.resume();
    } else if (audioPlayerRef.current) {
        audioPlayerRef.current.play().catch(stop);
    }
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
  }, [stop]);

  const findPlaylistItemIndex = (currentItemId: string) => {
    return playlist.findIndex(p => p.item.id === currentItemId);
  };

  const hasNext = () => {
    if (!currentItem) return false;
    const currentIndex = findPlaylistItemIndex(currentItem.item.id);
    return currentIndex > -1 && currentIndex < playlist.length - 1;
  };
  
  const hasPrevious = () => {
    if (!currentItem) return false;
    const currentIndex = findPlaylistItemIndex(currentItem.item.id);
    return currentIndex > 0;
  };

  const next = () => {
    if (hasNext() && currentItem) {
      const currentIndex = findPlaylistItemIndex(currentItem.item.id);
      play(playlist[currentIndex + 1], playlist);
    }
  };

  const previous = () => {
    if (hasPrevious() && currentItem) {
      const currentIndex = findPlaylistItemIndex(currentItem.item.id);
      play(playlist[currentIndex - 1], playlist);
    }
  };
  
  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;
    const handleAudioEnded = () => {
      if(isSpeakingRef.current && isMountedRef.current){
        segmentIndexRef.current++;
        speakNextSegment();
      }
    };
    const handleAudioPlaying = () => {
      if (isMountedRef.current && isPlaying) setIsLoading(false);
    };
    const handleAudioError = () => {
      if (isMountedRef.current) {
          toast({variant: "destructive", title: "Audio Error", description: "Failed to play audio."});
          stop();
      }
    };
    player.addEventListener('ended', handleAudioEnded);
    player.addEventListener('playing', handleAudioPlaying);
    player.addEventListener('error', handleAudioError);

    if (navigator.mediaSession) {
      navigator.mediaSession.setActionHandler('play', () => (isPaused ? resume() : play()));
      navigator.mediaSession.setActionHandler('pause', () => pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => next());
      navigator.mediaSession.setActionHandler('previoustrack', () => previous());
    }

    return () => {
      player.removeEventListener('ended', handleAudioEnded);
      player.removeEventListener('playing', handleAudioPlaying);
      player.removeEventListener('error', handleAudioError);
      if (player.src && !player.paused) player.pause();
      player.src = "";
      if(audioPlayerRef.current === player) audioPlayerRef.current = null;
      if (navigator.mediaSession) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
      }
      releaseWakeLock();
    };
  }, [speakNextSegment, stop, toast, isPaused, resume, play, pause, next, previous]);

  const value: PlaybackContextType = {
    isPlaying,
    isPaused,
    isLoading,
    currentItem,
    playlist,
    currentText,
    play,
    pause,
    resume,
    stop,
    next,
    previous,
    hasNext,
    hasPrevious,
    playbackMode,
    setPlaybackMode,
    originalTextTtsSettings,
    setOriginalTextTtsSettings,
    yourNoteTtsSettings,
    setYourNoteTtsSettings,
  };

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
};
