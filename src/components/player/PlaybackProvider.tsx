
"use client";

import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import type { FavoriteItem, NoteFavoriteItem, TTSSettings, MediaFavoriteItem } from '@/types';
import { getCloudSpeech } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import * as LocalStorage from '@/lib/localStorageService';

const PUNCTUATION_REGEX_FOR_SPLIT = /([.,?!,。？！，、\n\r]+)/g;
const PUNCTUATION_REGEX = /[.,?!,。？！，、\n\r"“„”'‘’`*_{}\[\]()#&@:;~<>/\\|\-—–^%$《》]/g;

type PlayableItem =
  | { type: 'favorite'; item: FavoriteItem }
  | { type: 'note_favorite'; item: NoteFavoriteItem; part?: 'original' | 'note' }
  | { type: 'media_favorite'; item: MediaFavoriteItem };

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
  audioPlayerRef: React.RefObject<HTMLAudioElement | null>;
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

  const [originalTextTtsSettings, setOriginalTextTtsSettings] = useState<TTSSettings>(LocalStorage.defaultTTSSettings);
  const [yourNoteTtsSettings, setYourNoteTtsSettings] = useState<TTSSettings>(LocalStorage.defaultTTSSettings);
  
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechQueueRef = useRef<{ text: string; settings: TTSSettings; part?: 'original' | 'note' }[]>([]);
  const segmentIndexRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const isMountedRef = useRef(false);
  
  const functionsRef = useRef<any>({});


  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  },[]);


  const stop = useCallback((resetPlayerState = true) => {
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
      // Only reset src if it's currently set to something.
      if (audioPlayerRef.current.src) {
        audioPlayerRef.current.src = "";
      }
    }
    utteranceRef.current = null;

    if (resetPlayerState && isMountedRef.current) {
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

  const onPlaybackEnd = useCallback(() => {
    if (!isSpeakingRef.current) return;
  
    if (functionsRef.current.playbackMode === 'loop-single' && functionsRef.current.currentItem) {
        const { currentItem, playlist, currentIndex } = functionsRef.current;
        setTimeout(() => functionsRef.current.play(currentItem, playlist, currentIndex), 100);
    } else if (functionsRef.current.playbackMode === 'sequential') {
      const { playlist, currentIndex } = functionsRef.current;
      const nextIndex = currentIndex + 1;
      if (nextIndex < playlist.length) {
        setTimeout(() => functionsRef.current.play(playlist[nextIndex], playlist, nextIndex), 100);
      } else {
        functionsRef.current.stop();
      }
    } else {
      functionsRef.current.stop();
    }
  }, []);


  const speakNextSegment = useCallback(async () => {
    if (!isSpeakingRef.current || speechQueueRef.current.length === 0) {
      if (isMountedRef.current) onPlaybackEnd();
      return;
    }

    const currentPart = speechQueueRef.current[0];
    const segments = (currentPart.text.split(PUNCTUATION_REGEX_FOR_SPLIT) || [currentPart.text]).filter(Boolean);
    
    if (segmentIndexRef.current >= segments.length) {
      speechQueueRef.current.shift();
      segmentIndexRef.current = 0;
      if (speechQueueRef.current.length > 0) {
        if (isMountedRef.current) {
          setCurrentItem(prev => {
            if (!prev) return null;
            const nextPart = speechQueueRef.current[0];
            return {...prev, part: nextPart.part};
          });
        }
        await speakNextSegment();
      } else {
         if (isMountedRef.current) onPlaybackEnd();
      }
      return;
    }

    if (isMountedRef.current) setIsLoading(true);
    
    const segmentText = segments[segmentIndexRef.current];
    const cleanedText = segmentText.replace(PUNCTUATION_REGEX, ' ').trim();

    if (isMountedRef.current) {
      setCurrentText(cleanedText);
      const currentItemLocal = functionsRef.current.currentItem;
      if (currentItemLocal?.type === 'note_favorite') {
        setCurrentItem(prev => prev ? {...prev, part: currentPart.part} : null);
      }
    }

    const currentItemLocal = functionsRef.current.currentItem;
    if (navigator.mediaSession && currentItemLocal) {
        let title = cleanedText || (currentItemLocal.type === 'media_favorite' ? currentItemLocal.item.name : 'Reading...');
        
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title,
          artist: currentItemLocal.item.sourceDocumentName || 'MangaTalk',
          album: currentItemLocal.type === 'favorite' ? 'Favorited Texts' : (currentItemLocal.type === 'note_favorite' ? 'Favorited Notes' : 'Media Favorites'),
        });
    }

    if (!cleanedText) {
      segmentIndexRef.current++;
      await speakNextSegment();
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
      
      utterance.onend = () => { 
        if(utteranceRef.current === utterance && isSpeakingRef.current) { 
          utteranceRef.current = null;
          segmentIndexRef.current++;
          speakNextSegment();
        }
      };
      utterance.onerror = (event) => {
          if(utteranceRef.current === utterance && event.error !== 'canceled' && event.error !== 'interrupted') {
              console.error('SpeechSynthesis Error:', event);
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
        // Important Check: Ensure we are still in a speaking state before playing.
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
  }, [stop, toast, onPlaybackEnd]);
  
  const play = useCallback(async (item: PlayableItem, newPlaylist: PlayableItem[], startIndex: number) => {
    if (!isMountedRef.current) return;
    
    const isSameItem = currentItem?.item.id === item.item.id;
    if (isSameItem && isPlaying && !isPaused) {
      // If the same item is already playing, do nothing.
      return;
    }
    
    stop(false); // Stop current playback but keep player UI state
    
    isSpeakingRef.current = true;
    setCurrentItem(item);
    setPlaylist(newPlaylist);
    setCurrentIndex(startIndex);
    setIsPlaying(true);
    setIsPaused(false);
    setCurrentText(item.type === 'media_favorite' ? item.item.name : (item.type === 'favorite' ? item.item.text : (item.item.annotation.targetText || item.item.annotation.note || '')));

    if (item.type === 'media_favorite') {
        if (audioPlayerRef.current) {
            // The src is set by the media page, just need to play
            try {
                if (audioPlayerRef.current.src) {
                    await audioPlayerRef.current.play();
                }
            } catch (e) {
                console.error("Error playing media item:", e);
                stop();
            }
        }
    } else {
        speechQueueRef.current = [];
        segmentIndexRef.current = 0;
        
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
        
        await speakNextSegment();
    }
  }, [currentItem, isPlaying, isPaused, stop, originalTextTtsSettings, yourNoteTtsSettings, speakNextSegment]);


  const pause = useCallback(() => {
    if (!isSpeakingRef.current || !isMountedRef.current || isPaused) return;
    setIsPaused(true);
    if (utteranceRef.current && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
    } else if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
    }
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
  }, [isPaused]);

  const resume = useCallback(() => {
    if (!isSpeakingRef.current || !isMountedRef.current || !isPaused) return;
    setIsPaused(false);
    
    if (utteranceRef.current && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    } else if (audioPlayerRef.current?.paused) {
      audioPlayerRef.current.play().catch((err) => {
        console.error("Resume play error:", err);
        stop();
      });
    } else if (!utteranceRef.current && !audioPlayerRef.current?.src) {
      speakNextSegment();
    }
    
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
  }, [isPaused, speakNextSegment, stop]);

  const hasNext = () => currentIndex > -1 && currentIndex < playlist.length - 1;
  const hasPrevious = () => currentIndex > 0;

  const next = useCallback(() => {
    if (hasNext()) {
        const nextIndex = currentIndex + 1;
        const nextItem = playlist[nextIndex];
        play(nextItem, playlist, nextIndex);
    }
  }, [currentIndex, hasNext, playlist, play]);

  const previous = useCallback(() => {
    if (hasPrevious()) {
        const prevIndex = currentIndex - 1;
        const prevItem = playlist[prevIndex];
        play(prevItem, playlist, prevIndex);
    }
  }, [currentIndex, hasPrevious, playlist, play]);
  
  // Update functionsRef with the latest functions
  useEffect(() => {
    functionsRef.current.play = play;
    functionsRef.current.pause = pause;
    functionsRef.current.resume = resume;
    functionsRef.current.next = next;
    functionsRef.current.previous = previous;
    functionsRef.current.stop = stop;
    functionsRef.current.hasNext = hasNext;
    functionsRef.current.hasPrevious = hasPrevious;
    functionsRef.current.currentItem = currentItem;
    functionsRef.current.playlist = playlist;
    functionsRef.current.currentIndex = currentIndex;
    functionsRef.current.playbackMode = playbackMode;
  });

  const handleAudioEnded = useCallback(() => {
    if (isSpeakingRef.current && isMountedRef.current) {
        if (functionsRef.current.currentItem?.type !== 'media_favorite') {
            segmentIndexRef.current++;
            speakNextSegment();
        } else {
            onPlaybackEnd();
        }
    }
  }, [speakNextSegment, onPlaybackEnd]);

  useEffect(() => {
    const player = audioPlayerRef.current || new Audio();
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = player;
    }

    const handleAudioPlaying = () => {
      if (isMountedRef.current && isPlaying) setIsLoading(false);
    };
    const handleAudioError = (e: any) => {
        if (e?.target?.error?.message?.includes('interrupted')) {
            return;
        }
        if (isMountedRef.current) {
            toast({variant: "destructive", title: "Audio Error", description: "Failed to play audio."});
            stop();
        }
    };

    player.addEventListener('ended', handleAudioEnded);
    player.addEventListener('playing', handleAudioPlaying);
    player.addEventListener('error', handleAudioError);

    if (navigator.mediaSession) {
      navigator.mediaSession.setActionHandler('play', () => functionsRef.current.resume());
      navigator.mediaSession.setActionHandler('pause', () => functionsRef.current.pause());
      navigator.mediaSession.setActionHandler('nexttrack', hasNext() ? () => functionsRef.current.next() : null);
      navigator.mediaSession.setActionHandler('previoustrack', hasPrevious() ? () => functionsRef.current.previous() : null);
      navigator.mediaSession.setActionHandler('stop', () => functionsRef.current.stop());
    }

    return () => {
      player.removeEventListener('ended', handleAudioEnded);
      player.removeEventListener('playing', handleAudioPlaying);
      player.removeEventListener('error', handleAudioError);
      
      if (navigator.mediaSession) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('stop', null);
      }
    };
  }, [isPlaying, toast, stop, handleAudioEnded, hasNext, hasPrevious]);

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
    audioPlayerRef,
  };

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}
