
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import type { MangaPage, TTSSettings, TTSVoice } from '@/types';
import { performOCR, getCloudSpeech } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Cloud, Loader2, Play, Pause, Smartphone, Stop, UploadCloud, Volume2, XCircle } from 'lucide-react';
import * as LocalStorage from '@/lib/localStorageService';

export function MangaRoom() {
  const { toast } = useToast();
  const [pages, setPages] = useState<MangaPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [ttsSettings, setTtsSettings] = useState<TTSSettings>(LocalStorage.defaultTTSSettings);
  const [isLoadingOCR, setIsLoadingOCR] = useState(false);
  const [isLoadingTTS, setIsLoadingTTS] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);
  
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setPages(LocalStorage.loadPages());
    setCurrentPageIndex(LocalStorage.loadCurrentPageIndex());
    setTtsSettings(LocalStorage.loadTTSSettings());
  }, []);

  useEffect(() => {
    LocalStorage.savePages(pages);
  }, [pages]);

  useEffect(() => {
    LocalStorage.saveCurrentPageIndex(currentPageIndex);
  }, [currentPageIndex]);

  useEffect(() => {
    LocalStorage.saveTTSSettings(ttsSettings);
  }, [ttsSettings]);

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
      // Set default voice if none selected and voices are available
      if (!ttsSettings.voiceURI && voices.length > 0) {
        const defaultVoice = voices.find(v => v.lang === ttsSettings.language && v.default) || voices.find(v => v.lang === ttsSettings.language) || voices.find(v => v.default) || voices[0];
        if (defaultVoice) {
          setTtsSettings(prev => ({ ...prev, voiceURI: defaultVoice.voiceURI }));
        }
      }
    }
  }, [ttsSettings.language, ttsSettings.voiceURI]);

  useEffect(() => {
    populateVoiceList();
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = populateVoiceList;
    }
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
        stopSpeech(); // Clean up speech synthesis on unmount
      }
    };
  }, [populateVoiceList]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoadingOCR(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const imageDataUrl = e.target?.result as string;
      const ocrResult = await performOCR(imageDataUrl);
      if ('extractedText' in ocrResult) {
        const newPage: MangaPage = {
          id: Date.now().toString(),
          imageDataUrl,
          extractedText: ocrResult.extractedText,
          title: file.name,
        };
        setPages(prev => [...prev, newPage]);
        setCurrentPageIndex(pages.length); // Go to new page
        toast({ title: "OCR Success", description: "Text extracted from page." });
      } else {
        toast({ variant: "destructive", title: "OCR Error", description: ocrResult.error });
      }
      setIsLoadingOCR(false);
    };
    reader.readAsDataURL(file);
    event.target.value = ''; // Reset file input
  };

  const currentMangaPage = pages[currentPageIndex];
  const textToRead = currentMangaPage?.extractedText || "";

  const playSpeech = async () => {
    if (!textToRead) {
      toast({ variant: "destructive", title: "No Text", description: "No text available to read." });
      return;
    }
    stopSpeech(); // Stop any current speech
    setIsLoadingTTS(true);
    setIsSpeaking(true);

    if (ttsSettings.type === 'local') {
      if (!window.speechSynthesis) {
        toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
        setIsLoadingTTS(false);
        setIsSpeaking(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(textToRead);
      utterance.lang = ttsSettings.language;
      utterance.pitch = ttsSettings.pitch;
      utterance.rate = ttsSettings.rate;
      
      const selectedVoice = availableVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
      if (selectedVoice) {
        // Find the actual SpeechSynthesisVoice object
        const browserVoice = window.speechSynthesis.getVoices().find(v => v.voiceURI === selectedVoice.voiceURI);
        if (browserVoice) utterance.voice = browserVoice;
      }
      
      utterance.onend = () => {
        setIsSpeaking(false);
        setIsLoadingTTS(false);
      };
      utterance.onerror = (event) => {
        toast({ variant: "destructive", title: "TTS Error", description: event.error || "Failed to play speech." });
        setIsSpeaking(false);
        setIsLoadingTTS(false);
      };
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    } else { // Cloud TTS
      const cloudResult = await getCloudSpeech(textToRead, ttsSettings.language);
      if ('audioUrl' in cloudResult) {
        if (audioPlayerRef.current) {
          audioPlayerRef.current.src = cloudResult.audioUrl;
          audioPlayerRef.current.play().catch(err => {
            toast({variant: "destructive", title: "Audio Playback Error", description: err.message});
            setIsSpeaking(false);
          });
        }
      } else {
        toast({ variant: "destructive", title: "Cloud TTS Error", description: cloudResult.error });
        setIsSpeaking(false);
        setIsLoadingTTS(false);
      }
    }
  };

  const pauseSpeech = () => {
    if (ttsSettings.type === 'local' && window.speechSynthesis && utteranceRef.current) {
      window.speechSynthesis.pause();
      setIsSpeaking(false); // Reflects paused state
    } else if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      setIsSpeaking(false);
    }
  };
  
  const resumeSpeech = () => {
     if (ttsSettings.type === 'local' && window.speechSynthesis && utteranceRef.current) {
      window.speechSynthesis.resume();
      setIsSpeaking(true);
    } else if (audioPlayerRef.current) {
      audioPlayerRef.current.play().catch(err => {
         toast({variant: "destructive", title: "Audio Playback Error", description: err.message});
      });
      setIsSpeaking(true);
    }
  };

  const stopSpeech = () => {
    if (ttsSettings.type === 'local' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    } else if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
    }
    if (utteranceRef.current) utteranceRef.current.onend = null; // Prevent onend firing after explicit stop
    setIsSpeaking(false);
    setIsLoadingTTS(false);
  };
  
  useEffect(() => {
    // Setup for cloud audio player
    const player = new Audio();
    audioPlayerRef.current = player;
    player.onended = () => {
      setIsSpeaking(false);
      setIsLoadingTTS(false);
    };
    player.oncanplay = () => {
       // Only set loading to false if it's cloud TTS and we are expecting to play
      if (ttsSettings.type === 'cloud' && isSpeaking) {
         setIsLoadingTTS(false);
      }
    };
    player.onerror = () => {
      toast({variant: "destructive", title: "Audio Error", description: "Failed to load or play audio."});
      setIsSpeaking(false);
      setIsLoadingTTS(false);
    };
    return () => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current = null;
      }
      stopSpeech();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsSettings.type]);


  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    setTtsSettings(prev => ({ ...prev, [key]: value }));
  };

  const navigatePage = (direction: 'next' | 'prev') => {
    stopSpeech();
    if (direction === 'next' && currentPageIndex < pages.length - 1) {
      setCurrentPageIndex(prev => prev + 1);
    } else if (direction === 'prev' && currentPageIndex > 0) {
      setCurrentPageIndex(prev => prev - 1);
    }
  };
  
  const removePage = (pageId: string) => {
    stopSpeech();
    const newPages = pages.filter(p => p.id !== pageId);
    const newPageIndex = Math.max(0, Math.min(currentPageIndex, newPages.length - 1));
    setPages(newPages);
    setCurrentPageIndex(newPages.length === 0 ? 0 : newPageIndex);
    if (newPages.length === 0) {
      // Clear current page index if no pages left, to avoid issues.
      // This state also implies no page is displayed.
       setCurrentPageIndex(0); // Or handle as an "empty" state
    }
  };

  const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString() : '';
  const effectiveTextToRead = selectedText || textToRead;

  return (
    <div className="container mx-auto p-4 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Upload Manga Page</CardTitle>
          <CardDescription>Upload an image of a manga page. Text will be extracted using OCR.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="manga-page-upload">Manga Page Image</Label>
            <Input id="manga-page-upload" type="file" accept="image/*" onChange={handleFileUpload} disabled={isLoadingOCR} />
          </div>
          {isLoadingOCR && <Progress value={undefined} className="w-full mt-2" />}
        </CardContent>
      </Card>

      {pages.length > 0 && currentMangaPage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Viewing: {currentMangaPage.title || `Page ${currentPageIndex + 1}`}</span>
              <Button variant="ghost" size="icon" onClick={() => removePage(currentMangaPage.id)} aria-label="Remove page">
                <XCircle className="h-5 w-5 text-destructive" />
              </Button>
            </CardTitle>
             <CardDescription>
              Page {currentPageIndex + 1} of {pages.length}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative aspect-[2/3] w-full max-w-md mx-auto bg-muted rounded-md overflow-hidden shadow-lg">
              <Image
                src={currentMangaPage.imageDataUrl}
                alt={`Manga Page ${currentPageIndex + 1}`}
                layout="fill"
                objectFit="contain"
                data-ai-hint="manga page"
              />
            </div>
            <div className="flex justify-between items-center">
              <Button onClick={() => navigatePage('prev')} disabled={currentPageIndex === 0 || isLoadingTTS}>
                <ChevronLeft /> Previous
              </Button>
              <Button onClick={() => navigatePage('next')} disabled={currentPageIndex === pages.length - 1 || isLoadingTTS}>
                Next <ChevronRight />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      {currentMangaPage?.extractedText && (
         <Card>
          <CardHeader>
            <CardTitle>Extracted Text</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-60 overflow-y-auto p-2 border rounded-md bg-muted/50 whitespace-pre-wrap text-sm">
              {currentMangaPage.extractedText}
            </div>
          </CardContent>
        </Card>
      )}

      {textToRead && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Volume2 className="text-primary" /> Text-to-Speech Controls</CardTitle>
            <CardDescription>Configure and play the extracted text.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="tts-type">TTS Engine</Label>
                <Select value={ttsSettings.type} onValueChange={(v) => handleSettingChange('type', v as 'local' | 'cloud')}>
                  <SelectTrigger id="tts-type">
                    <SelectValue placeholder="Select TTS type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local"><div className="flex items-center gap-2"><Smartphone /> Local Browser TTS</div></SelectItem>
                    <SelectItem value="cloud"><div className="flex items-center gap-2"><Cloud /> Cloud TTS</div></SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="tts-language">Language</Label>
                 <Input 
                    id="tts-language" 
                    value={ttsSettings.language} 
                    onChange={(e) => handleSettingChange('language', e.target.value)}
                    placeholder="e.g. en-US, ja-JP"
                  />
              </div>
            </div>

            {ttsSettings.type === 'local' && availableVoices.length > 0 && (
              <div>
                <Label htmlFor="tts-voice">Voice (Local)</Label>
                <Select value={ttsSettings.voiceURI} onValueChange={(v) => handleSettingChange('voiceURI', v)}>
                  <SelectTrigger id="tts-voice">
                    <SelectValue placeholder="Select voice" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {availableVoices.filter(v => v.lang.startsWith(ttsSettings.language.split('-')[0])).map(voice => (
                      <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} ({voice.lang}) {voice.default ? "[Default]" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="tts-rate">Rate: {ttsSettings.rate.toFixed(1)}</Label>
              <Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tts-pitch">Pitch: {ttsSettings.pitch.toFixed(1)}</Label>
              <Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {!isSpeaking && !isLoadingTTS && (
                <Button onClick={playSpeech} disabled={!effectiveTextToRead}>
                  <Play className="mr-2" /> Play {selectedText ? "Selected" : "All"}
                </Button>
              )}
              {(isSpeaking || isLoadingTTS) && ttsSettings.type === 'local' && window.speechSynthesis && (
                <Button onClick={pauseSpeech} variant="outline">
                  <Pause className="mr-2" /> Pause
                </Button>
              )}
               {!isSpeaking && !isLoadingTTS && ttsSettings.type === 'local' && window.speechSynthesis && window.speechSynthesis.paused() && (
                 <Button onClick={resumeSpeech} variant="outline">
                  <Play className="mr-2" /> Resume
                </Button>
               )}
              {(isSpeaking || isLoadingTTS) && (
                <Button onClick={stopSpeech} variant="destructive">
                  <Stop className="mr-2" /> Stop
                </Button>
              )}
              {isLoadingTTS && <Loader2 className="animate-spin" />}
            </div>
             {selectedText && <p className="text-sm text-muted-foreground italic">Reading selected text: "{selectedText.substring(0,50)}..."</p>}
          </CardContent>
        </Card>
      )}
      {pages.length === 0 && !isLoadingOCR && (
        <Card className="text-center">
          <CardHeader>
            <CardTitle>No Manga Pages</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Upload a manga page image to get started.</p>
            <UploadCloud className="mx-auto my-4 h-12 w-12 text-muted-foreground" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
