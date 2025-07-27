
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
  setVideoPlayerRef: (node: HTMLVideoElement | null) => void;
  progress: number;
  duration: number;
  handleSeek: (value: number) => void;
  videoAspectRatio: number | null;
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
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null);

  const [originalTextTtsSettings, setOriginalTextTtsSettings] = useState<TTSSettings>(LocalStorage.defaultTTSSettings);
  const [yourNoteTtsSettings, setYourNoteTtsSettings] = useState<TTSSettings>(LocalStorage.defaultTTSSettings);
  
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const [videoPlayer, setVideoPlayer] = useState<HTMLVideoElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechQueueRef = useRef<{ text: string; settings: TTSSettings; part?: 'original' | 'note' }[]>([]);
  const segmentIndexRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const isMountedRef = useRef(false);
  
  const functionsRef = useRef<any>({});
  const mediaObjectUrlRef = useRef<string | null>(null);


  useEffect(() => {
    isMountedRef.current = true;
    audioPlayerRef.current = new Audio();
    return () => { 
        isMountedRef.current = false;
        functionsRef.current.stop();
    };
  },[]);

  const stop = useCallback((resetPlayerState = true) => {
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
      if(audioPlayerRef.current.src) {
        audioPlayerRef.current.removeAttribute('src');
        audioPlayerRef.current.load();
      }
    }
    if (videoPlayer) {
      videoPlayer.pause();
      if(videoPlayer.src) {
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
      }
    }
    
    if (mediaObjectUrlRef.current) {
        URL.revokeObjectURL(mediaObjectUrlRef.current);
        mediaObjectUrlRef.current = null;
    }

    if (resetPlayerState && isMountedRef.current) {
        setIsPlaying(false);
        setIsPaused(false);
        setIsLoading(false);
        setCurrentItem(null);
        setCurrentText('');
        setCurrentIndex(-1);
        setPlaylist([]);
        setProgress(0);
        setDuration(0);
        setVideoAspectRatio(null);
    }
    if (navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
    }
  }, [videoPlayer]);

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
  
  const play = useCallback((item: PlayableItem, newPlaylist: PlayableItem[], startIndex: number) => {
    if (!isMountedRef.current) return;

    stop(false);
    
    isSpeakingRef.current = true;
    
    setCurrentItem(item);
    setPlaylist(newPlaylist);
    setCurrentIndex(startIndex);
    setIsPlaying(true);
    setIsPaused(false);
    setIsLoading(true);
    setProgress(0);
    setDuration(0);
    setCurrentText(item.type === 'media_favorite' ? item.item.name : (item.type === 'favorite' ? item.item.text : (item.item.annotation.targetText || item.item.annotation.note || '')));

  }, [stop]);

  // Effect for TTS playback
  useEffect(() => {
    if (currentItem?.type !== 'media_favorite' && isPlaying) {
        speechQueueRef.current = [];
        segmentIndexRef.current = 0;
        
        if (currentItem.type === 'favorite') {
          speechQueueRef.current.push({ text: currentItem.item.text, settings: originalTextTtsSettings });
        } else if (currentItem.type === 'note_favorite') {
          if (currentItem.item.annotation.targetText) {
            speechQueueRef.current.push({ text: currentItem.item.annotation.targetText, settings: originalTextTtsSettings, part: 'original' });
          }
          if (currentItem.item.annotation.note) {
            speechQueueRef.current.push({ text: currentItem.item.annotation.note, settings: yourNoteTtsSettings, part: 'note' });
          }
        }
        
        speakNextSegment();
    }
  }, [currentItem, isPlaying, originalTextTtsSettings, yourNoteTtsSettings, speakNextSegment]);


  // Effect for VIDEO playback
  useEffect(() => {
    if (currentItem?.type === 'media_favorite' && currentItem.item.type === 'video' && videoPlayer && isPlaying) {
        const item = currentItem.item;
        const blob = new Blob([item.fileData], { type: item.originalType });
        const url = URL.createObjectURL(blob);
        mediaObjectUrlRef.current = url;
        videoPlayer.src = url;

        videoPlayer.play().catch(e => {
            console.error("Error playing video:", e);
            toast({ variant: "destructive", title: "Playback Error", description: `The video file could not be played.` });
            stop();
        });
    }

    return () => {
       if (currentItem?.type === 'media_favorite' && currentItem.item.type === 'video') {
         if (mediaObjectUrlRef.current) {
            URL.revokeObjectURL(mediaObjectUrlRef.current);
            mediaObjectUrlRef.current = null;
         }
       }
    };
  }, [currentItem, videoPlayer, isPlaying, stop, toast]);

  // Effect for AUDIO playback (media files)
  useEffect(() => {
      if (currentItem?.type === 'media_favorite' && currentItem.item.type === 'audio' && audioPlayerRef.current && isPlaying) {
          const item = currentItem.item;
          const blob = new Blob([item.fileData], { type: item.originalType });
          const url = URL.createObjectURL(blob);
          mediaObjectUrlRef.current = url;
          audioPlayerRef.current.src = url;

          audioPlayerRef.current.play().catch(e => {
              console.error("Error playing audio:", e);
              if (e.name !== 'AbortError') { // Ignore user-initiated aborts
                toast({ variant: "destructive", title: "Playback Error", description: `The audio file could not be played.` });
                stop();
              }
          });
      }
      return () => {
        if (currentItem?.type === 'media_favorite' && currentItem.item.type === 'audio') {
          if (mediaObjectUrlRef.current) {
             URL.revokeObjectURL(mediaObjectUrlRef.current);
             mediaObjectUrlRef.current = null;
          }
        }
     };
  }, [currentItem, isPlaying, stop, toast]);


  const pause = useCallback(() => {
    if (!isSpeakingRef.current || !isMountedRef.current || isPaused) return;
    setIsPaused(true);
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
    }
    audioPlayerRef.current?.pause();
    videoPlayer?.pause();

    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
  }, [isPaused, videoPlayer]);

  const resume = useCallback(() => {
    if (!isSpeakingRef.current || !isMountedRef.current || !isPaused) return;
    setIsPaused(false);
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';

    const item = functionsRef.current.currentItem;
    if (!item) return;

    if (item.type === 'media_favorite') {
        const player = item.item.type === 'video' ? videoPlayer : audioPlayerRef.current;
        player?.play().catch(() => stop());
        return;
    }
    
    // Logic for TTS
    const ttsEngine = speechQueueRef.current[0]?.settings.engine;
    if (ttsEngine === 'local') {
        if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
        }
    } else if (ttsEngine === 'cloud') {
        if (audioPlayerRef.current?.paused) {
            audioPlayerRef.current.play().catch(() => stop());
        }
    }
  }, [isPaused, stop, videoPlayer]);

  const handleSeek = (value: number) => {
    const player = currentItem?.type === 'media_favorite' 
      ? (currentItem.item.type === 'video' ? videoPlayer : audioPlayerRef.current)
      : audioPlayerRef.current;

    if (player && player.duration) {
      player.currentTime = (value / 100) * player.duration;
      setProgress(value);
    }
  };


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

  useEffect(() => {
    const audioPlayer = audioPlayerRef.current;

    const handlePlaying = (e: any) => { 
        if (isMountedRef.current && isPlaying) setIsLoading(false);
    };

    const handleLoadedMetadata = (e: any) => {
        if (!isMountedRef.current) return;
        setDuration(e.target.duration);
        if (e.target.tagName === 'VIDEO') {
            const aspectRatio = e.target.videoWidth / e.target.videoHeight;
            setVideoAspectRatio(aspectRatio);
        }
    };
    
    const handleError = (e: any) => {
        const errorMessage = e?.target?.error?.message?.toLowerCase() ?? "";
        if (errorMessage.includes('interrupted') || errorMessage.includes('aborted')) {
            console.warn("Playback was interrupted, likely by a user action. Ignoring error.");
            return;
        }

        if (isMountedRef.current) {
            toast({variant: "destructive", title: "Media Error", description: "Failed to play media."});
            stop();
        }
    };
    
    const handleTimeUpdate = (e: any) => {
        if(isMountedRef.current && e.target.duration > 0) {
            setProgress((e.target.currentTime / e.target.duration) * 100);
        }
    }

    const ttsAudioPlayer = audioPlayerRef.current; // The one for TTS
    if (ttsAudioPlayer) {
      ttsAudioPlayer.addEventListener('ended', onPlaybackEnd);
      ttsAudioPlayer.addEventListener('playing', handlePlaying);
      ttsAudioPlayer.addEventListener('error', handleError);
    }

    const mediaAudioPlayer = audioPlayerRef.current; // The one for Media files
    mediaAudioPlayer?.addEventListener('ended', handleMediaEnded);
    mediaAudioPlayer?.addEventListener('playing', handlePlaying);
    mediaAudioPlayer?.addEventListener('loadedmetadata', handleLoadedMetadata);
    mediaAudioPlayer?.addEventListener('timeupdate', handleTimeUpdate);
    mediaAudioPlayer?.addEventListener('error', handleError);
    
    videoPlayer?.addEventListener('ended', handleMediaEnded);
    videoPlayer?.addEventListener('playing', handlePlaying);
    videoPlayer?.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoPlayer?.addEventListener('timeupdate', handleTimeUpdate);
    videoPlayer?.addEventListener('error', handleError);

    if (navigator.mediaSession) {
      navigator.mediaSession.setActionHandler('play', () => functionsRef.current.resume());
      navigator.mediaSession.setActionHandler('pause', () => functionsRef.current.pause());
      navigator.mediaSession.setActionHandler('nexttrack', hasNext() ? () => functionsRef.current.next() : null);
      navigator.mediaSession.setActionHandler('previoustrack', hasPrevious() ? () => functionsRef.current.previous() : null);
      navigator.mediaSession.setActionHandler('stop', () => functionsRef.current.stop());
    }

    return () => {
      if (ttsAudioPlayer) {
        ttsAudioPlayer.removeEventListener('ended', onPlaybackEnd);
        ttsAudioPlayer.removeEventListener('playing', handlePlaying);
        ttsAudioPlayer.removeEventListener('error', handleError);
      }
      mediaAudioPlayer?.removeEventListener('ended', handleMediaEnded);
      mediaAudioPlayer?.removeEventListener('playing', handlePlaying);
      mediaAudioPlayer?.removeEventListener('loadedmetadata', handleLoadedMetadata);
      mediaAudioPlayer?.removeEventListener('timeupdate', handleTimeUpdate);
      mediaAudioPlayer?.removeEventListener('error', handleError);

      videoPlayer?.removeEventListener('ended', handleMediaEnded);
      videoPlayer?.removeEventListener('playing', handlePlaying);
      videoPlayer?.removeEventListener('loadedmetadata', handleLoadedMetadata);
      videoPlayer?.removeEventListener('timeupdate', handleTimeUpdate);
      videoPlayer?.removeEventListener('error', handleError);
      
      if (navigator.mediaSession) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('stop', null);
      }
    };
  }, [isPlaying, toast, stop, handleMediaEnded, onPlaybackEnd, hasNext, hasPrevious, videoPlayer]);

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
    setVideoPlayerRef: setVideoPlayer,
    progress,
    duration,
    handleSeek,
    videoAspectRatio,
  };

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}
