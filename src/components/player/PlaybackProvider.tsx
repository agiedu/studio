
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
  audioPlayerRef: React.RefObject<HTMLAudioElement>;
  videoPlayerRef: React.RefObject<HTMLVideoElement>;
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
  const videoPlayerRef = useRef<HTMLVideoElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechQueueRef = useRef<{ text: string; settings: TTSSettings; part?: 'original' | 'note' }[]>([]);
  const segmentIndexRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const isMountedRef = useRef(false);
  
  const functionsRef = useRef<any>({});


  useEffect(() => {
    isMountedRef.current = true;
    audioPlayerRef.current = new Audio();
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
      audioPlayerRef.current.removeAttribute('src');
      audioPlayerRef.current.load();
    }
     if (videoPlayerRef.current) {
      videoPlayerRef.current.pause();
      videoPlayerRef.current.removeAttribute('src');
      videoPlayerRef.current.load();
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
    if (!isSpeakingRef.current || !isMountedRef.current) return;
  
    const { playbackMode: currentMode, currentItem: item, playlist: pl, currentIndex: idx } = functionsRef.current;

    if (currentMode === 'loop-single' && item) {
        setTimeout(() => functionsRef.current.play(item, pl, idx), 100);
    } else if (currentMode === 'sequential' && pl.length > 0) {
        let nextIndex = idx + 1;
        if (nextIndex >= pl.length) {
            nextIndex = 0; // Loop back to the beginning
        }
        setTimeout(() => functionsRef.current.play(pl[nextIndex], pl, nextIndex), 100);
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
    
    stop(false);
    
    isSpeakingRef.current = true;
    setCurrentItem(item);
    setPlaylist(newPlaylist);
    setCurrentIndex(startIndex);
    setIsPlaying(true);
    setIsPaused(false);
    setIsLoading(true);
    setCurrentText(item.type === 'media_favorite' ? item.item.name : (item.type === 'favorite' ? item.item.text : (item.item.annotation.targetText || item.item.annotation.note || '')));

    if (item.type === 'media_favorite') {
        const player = item.item.type === 'video' ? videoPlayerRef.current : audioPlayerRef.current;
        if (player) {
             const blob = new Blob([item.item.fileData], { type: item.item.originalType });
             const url = URL.createObjectURL(blob);
             player.src = url;
            try {
                await player.play();
            } catch (e) {
                console.error("Error playing media item:", e);
                toast({ variant: "destructive", title: "Playback Error", description: "The media file could not be played." });
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
  }, [stop, originalTextTtsSettings, yourNoteTtsSettings, speakNextSegment, toast]);


  const pause = useCallback(() => {
    if (!isSpeakingRef.current || !isMountedRef.current || isPaused) return;
    setIsPaused(true);
    if (utteranceRef.current && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
    }
    audioPlayerRef.current?.pause();
    videoPlayerRef.current?.pause();

    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
  }, [isPaused]);

  const resume = useCallback(() => {
    if (!isSpeakingRef.current || !isMountedRef.current || !isPaused) return;
    setIsPaused(false);
    
    if (utteranceRef.current && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    } else {
        const player = currentItem?.type === 'media_favorite' && currentItem.item.type === 'video' ? videoPlayerRef.current : audioPlayerRef.current;
        if (player?.paused) {
            player.play().catch((err) => {
                if (err.name !== 'AbortError') {
                    console.error("Resume play error:", err);
                    toast({ variant: "destructive", title: "Resume Error", description: "Could not resume playback." });
                    stop();
                }
            });
        }
    }
    
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
  }, [isPaused, currentItem, stop, toast]);

  const hasNext = () => currentIndex > -1 && currentIndex < playlist.length - 1;
  const hasPrevious = () => currentIndex > 0;

  const next = useCallback(() => {
    if (hasNext()) {
        const nextIndex = currentIndex + 1;
        const nextItem = playlist[nextIndex];
        play(nextItem, playlist, nextIndex);
    } else if (playbackMode === 'sequential' && playlist.length > 0) {
        // Loop to start if it's the end and mode is sequential
        play(playlist[0], playlist, 0);
    }
  }, [currentIndex, hasNext, playlist, play, playbackMode]);

  const previous = useCallback(() => {
    if (hasPrevious()) {
        const prevIndex = currentIndex - 1;
        const prevItem = playlist[prevIndex];
        play(prevItem, playlist, prevIndex);
    }
  }, [currentIndex, hasPrevious, playlist, play]);
  
  useEffect(() => {
    functionsRef.current = { play, pause, resume, next, previous, stop, hasNext, hasPrevious, currentItem, playlist, currentIndex, playbackMode };
  });

  const handleMediaEnded = useCallback(() => {
    if (isSpeakingRef.current && isMountedRef.current) {
       onPlaybackEnd();
    }
  }, [onPlaybackEnd]);

  const handleTtsEnded = useCallback(() => {
      if (isSpeakingRef.current && isMountedRef.current) {
          if (functionsRef.current.currentItem?.type !== 'media_favorite') {
              segmentIndexRef.current++;
              speakNextSegment();
          }
      }
  }, [speakNextSegment]);

  useEffect(() => {
    const audioPlayer = audioPlayerRef.current;
    const videoPlayer = videoPlayerRef.current;

    const handlePlaying = () => { if (isMountedRef.current && isPlaying) setIsLoading(false); };
    const handleError = (e: any) => {
        if (e?.target?.error?.message?.toLowerCase().includes('interrupted')) return;
        if (isMountedRef.current) {
            toast({variant: "destructive", title: "Media Error", description: "Failed to play media."});
            stop();
        }
    };

    // Use handleMediaEnded for both audio and video HTML elements
    audioPlayer?.addEventListener('ended', handleMediaEnded);
    videoPlayer?.addEventListener('ended', handleMediaEnded);

    audioPlayer?.addEventListener('playing', handlePlaying);
    videoPlayer?.addEventListener('playing', handlePlaying);
    audioPlayer?.addEventListener('error', handleError);
    videoPlayer?.addEventListener('error', handleError);

    if (navigator.mediaSession) {
      navigator.mediaSession.setActionHandler('play', () => functionsRef.current.resume());
      navigator.mediaSession.setActionHandler('pause', () => functionsRef.current.pause());
      navigator.mediaSession.setActionHandler('nexttrack', hasNext() ? () => functionsRef.current.next() : null);
      navigator.mediaSession.setActionHandler('previoustrack', hasPrevious() ? () => functionsRef.current.previous() : null);
      navigator.mediaSession.setActionHandler('stop', () => functionsRef.current.stop());
    }

    return () => {
      audioPlayer?.removeEventListener('ended', handleMediaEnded);
      videoPlayer?.removeEventListener('ended', handleMediaEnded);
      audioPlayer?.removeEventListener('playing', handlePlaying);
      videoPlayer?.removeEventListener('playing', handlePlaying);
      audioPlayer?.removeEventListener('error', handleError);
      videoPlayer?.removeEventListener('error', handleError);
      
      if (navigator.mediaSession) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('stop', null);
      }
    };
  }, [isPlaying, toast, stop, handleMediaEnded, hasNext, hasPrevious]);

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
    audioPlayerRef: audioPlayerRef as React.RefObject<HTMLAudioElement>,
    videoPlayerRef: videoPlayerRef as React.RefObject<HTMLVideoElement>,
  };

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}
