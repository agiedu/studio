
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
  play: (item: PlayableItem, playlist: PlayableItem[], startIndex: number) => void;
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
  setOriginalTextTtsSettings: React.Dispatch<React.SetStateAction<TTSSettings>>;
  yourNoteTtsSettings: TTSSettings;
  setYourNoteTtsSettings: React.Dispatch<React.SetStateAction<TTSSettings>>;
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
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [currentText, setCurrentText] = useState('');
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('default');

  const [originalTextTtsSettings, setOriginalTextTtsSettings] = useState<TTSSettings>({ type: 'local', language: 'en-US', rate: 1, pitch: 1, engine: 'local' });
  const [yourNoteTtsSettings, setYourNoteTtsSettings] = useState<TTSSettings>({ type: 'local', language: 'en-US', rate: 1, pitch: 1, engine: 'local' });
  
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechQueueRef = useRef<{ text: string; settings: TTSSettings; part?: 'original' | 'note' }[]>([]);
  const segmentIndexRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const isMountedRef = useRef(false);

  // Store the onPlaybackEnd function in a ref to break the circular dependency
  const onPlaybackEndRef = useRef<() => void>(() => {});

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  },[]);

  const stop = useCallback(() => {
    isSpeakingRef.current = false;
    speechQueueRef.current = [];
    if (utteranceRef.current) {
      utteranceRef.current.onend = null;
      utteranceRef.current.onerror = null;
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
    utteranceRef.current = null;

    if (isMountedRef.current) {
        setIsPlaying(false);
        setIsPaused(false);
        setIsLoading(false);
        setCurrentItem(null);
        setCurrentText('');
        setCurrentIndex(-1);
        setPlaylist([]);
    }
    if (navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
    }
  }, []);

  const play = useCallback((item: PlayableItem, newPlaylist: PlayableItem[], startIndex: number) => {
    stop();
    if(isMountedRef.current) {
        setIsPlaying(true);
        setIsPaused(false);
        setCurrentItem(item);
        setPlaylist(newPlaylist);
        setCurrentIndex(startIndex);
    }
    isSpeakingRef.current = true;
    segmentIndexRef.current = 0;
    speechQueueRef.current = [];
    
    if (item.type === 'favorite') {
      speechQueueRef.current.push({ text: item.item.text, settings: originalTextTtsSettings });
    } else if (item.type === 'note_favorite') {
      if (item.item.annotation.targetText) {
        speechQueueRef.current.push({ text: item.item.annotation.targetText, settings: originalTextTtsSettings, part: 'original' });
      }
      if (item.item.annotation.note) {
        speechQueueRef.current.push({ text: item.item.annotation.note, settings: yourNoteTtsSettings, part: 'note' });
      }
    }

    if (speechQueueRef.current.length === 0 || speechQueueRef.current.every(p => !p.text.trim())) {
      toast({ variant: 'destructive', title: 'No Text', description: 'This item has no text to read.' });
      onPlaybackEndRef.current();
      return;
    }
    
    speakNextSegment();
  }, [stop, originalTextTtsSettings, yourNoteTtsSettings, toast]);


  const speakNextSegment = useCallback(async () => {
    if (!isSpeakingRef.current || speechQueueRef.current.length === 0) {
      if (isMountedRef.current) {
        onPlaybackEndRef.current();
      }
      return;
    }

    const currentPart = speechQueueRef.current[0];
    const segments = (currentPart.text.match(PUNCTUATION_REGEX_FOR_SPLIT) || [currentPart.text]).filter(Boolean);
    if (segmentIndexRef.current >= segments.length) {
      speechQueueRef.current.shift();
      segmentIndexRef.current = 0;
      speakNextSegment();
      return;
    }

    if (isMountedRef.current) setIsLoading(true);
    
    const segmentText = segments[segmentIndexRef.current];
    const cleanedText = segmentText.replace(PUNCTUATION_REGEX_FOR_CLEANUP, ' ').trim();

    if (isMountedRef.current) setCurrentText(cleanedText);

    if (navigator.mediaSession && currentItem) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: cleanedText,
          artist: currentItem.item.sourceDocumentName || 'MangaTalk',
          album: currentItem.type === 'favorite' ? 'Favorited Texts' : 'Favorited Notes',
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
      
      utterance.onend = () => { if(utteranceRef.current === utterance && isSpeakingRef.current) { segmentIndexRef.current++; speakNextSegment(); } };
      utterance.onerror = (event) => {
          if(utteranceRef.current === utterance && event.error !== 'canceled') {
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
  }, [stop, toast, currentItem]);

  // This effect updates the ref whenever the dependencies of onPlaybackEnd change.
  useEffect(() => {
    onPlaybackEndRef.current = () => {
      if (!isSpeakingRef.current) return;
    
      switch (playbackMode) {
        case 'loop-single':
          if(currentItem && playlist.length > 0) {
             setTimeout(() => play(currentItem, playlist, currentIndex), 100);
          } else {
             stop();
          }
          break;
        case 'sequential':
          const nextIndex = currentIndex + 1;
          if (nextIndex < playlist.length) {
            setTimeout(() => play(playlist[nextIndex], playlist, nextIndex), 100);
          } else {
            stop();
          }
          break;
        case 'default':
        default:
          stop();
          break;
      }
    };
  }, [currentIndex, playlist, playbackMode, stop, currentItem, play]);


  const pause = useCallback(() => {
    if (!isSpeakingRef.current || !isMountedRef.current) return;
    setIsPaused(true);
    if (utteranceRef.current) {
        if(window.speechSynthesis.speaking) window.speechSynthesis.pause();
    } else if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
    }
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
  }, []);

  const resume = useCallback(() => {
    if (!isSpeakingRef.current || !isMountedRef.current) return;
    setIsPaused(false);
    if (utteranceRef.current) {
        if(window.speechSynthesis.paused) window.speechSynthesis.resume();
    } else if (audioPlayerRef.current) {
        audioPlayerRef.current.play().catch(stop);
    }
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
  }, [stop]);

  const hasNext = () => currentIndex > -1 && currentIndex < playlist.length - 1;
  
  const hasPrevious = () => currentIndex > 0;

  const next = () => {
    if (hasNext()) {
      play(playlist[currentIndex + 1], playlist, currentIndex + 1);
    }
  };

  const previous = () => {
    if (hasPrevious()) {
      play(playlist[currentIndex - 1], playlist, currentIndex - 1);
    }
  };
  
  const handlePlayAction = useCallback(() => {
      if (isPaused) {
        resume();
      } else {
        // Fallback to starting playback from the beginning of the list if nothing else makes sense
        if (playlist.length > 0) {
            play(playlist[0], playlist, 0);
        }
      }
  }, [isPaused, resume, play, playlist]);

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
      navigator.mediaSession.setActionHandler('play', () => isPlaying ? resume() : handlePlayAction());
      navigator.mediaSession.setActionHandler('pause', () => pause());
      navigator.mediaSession.setActionHandler('nexttrack', hasNext() ? () => next() : null);
      navigator.mediaSession.setActionHandler('previoustrack', hasPrevious() ? () => previous() : null);
      navigator.mediaSession.setActionHandler('stop', () => stop());
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
        navigator.mediaSession.setActionHandler('stop', null);
      }
    };
  }, [speakNextSegment, stop, toast, isPlaying, isPaused, resume, play, pause, next, previous, playlist, handlePlayAction, hasNext, hasPrevious]);

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
