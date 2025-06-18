
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getDocument, GlobalWorkerOptions, version as pdfjsVersion } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Loader2, Play, Pause, Smartphone, Cloud as CloudIcon, AlertTriangle, Info, Star } from 'lucide-react';
import { getCloudSpeech } from '@/app/actions';
import * as LocalStorage from '@/lib/localStorageService';
import type { StoredDocument, TTSVoice, FavoriteItem, TTSSettings as GlobalTTSSettings } from '@/types';
import { cn } from '@/lib/utils';


// Helper to convert base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  try {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    console.error("Failed to decode Base64 string for PDF processing:", e);
    throw new Error("Invalid Base64 data for PDF.");
  }
}


export default function ReaderPage() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const docId = searchParams.get('docId');

  const [loadedDocument, setLoadedDocument] = useState<StoredDocument | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<string>("");
  const [isLoadingDocument, setIsLoadingDocument] = useState<boolean>(false);
  const [isLoadingTTS, setIsLoadingTTS] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  const [ttsSettings, setTtsSettings] = useState<GlobalTTSSettings>(LocalStorage.defaultTTSSettings);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);
  
  const [sentenceSegments, setSentenceSegments] = useState<string[]>([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number>(-1);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
      setTtsSettings(LocalStorage.loadTTSSettings());
    }
  }, []);

  useEffect(() => {
    if (docId) {
      setIsLoadingDocument(true);
      setExtractedText("");
      setSentenceSegments([]);
      setCurrentSentenceIndex(-1);
      setFileName(null);
      setLoadedDocument(null);
      stopSpeech(true);

      const doc = LocalStorage.getStoredDocumentById(docId);
      if (doc) {
        setLoadedDocument(doc);
        setFileName(doc.name);
        if (doc.type === 'txt') {
          setExtractedText(doc.textContent);
          setIsLoadingDocument(false);
        } else if (doc.type === 'pdf') {
          processPdfContent(doc.pdfBase64);
        }
      } else {
        toast({ variant: "destructive", title: "Document Not Found", description: "The requested document could not be found in your library." });
        setExtractedText("Error: Document not found.");
        setIsLoadingDocument(false);
      }
    } else {
      setExtractedText("No document loaded. Please select a document from your library.");
      setFileName(null);
      setLoadedDocument(null);
      setIsLoadingDocument(false);
    }
  }, [docId, toast]);


  const processPdfContent = async (pdfBase64: string) => {
    try {
      const pdfData = base64ToUint8Array(pdfBase64);
      const pdf = await getDocument({ data: pdfData }).promise;
      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => ('str' in item ? item.str : '')).join(" ") + "\n\n";
      }
      setExtractedText(fullText.trim() || "No text could be extracted from this PDF.");
    } catch (error: any) {
      console.error("PDF Processing Error:", error);
      toast({ variant: "destructive", title: "PDF Processing Error", description: error.message || "Failed to extract text from PDF." });
      setExtractedText("Error processing PDF. It might be image-based, corrupted, or use a format pdf.js cannot read.");
    } finally {
      setIsLoadingDocument(false);
    }
  };


  const stopSpeech = useCallback((resetUIState = true) => {
    if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    } else if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      if (audioPlayerRef.current.src && audioPlayerRef.current.readyState >= HTMLMediaElement.HAVE_METADATA) {
         try { audioPlayerRef.current.currentTime = 0; } catch (e) { /* ignore */ }
      }
    }

    if (utteranceRef.current) {
      utteranceRef.current.onend = null;
      utteranceRef.current.onboundary = null;
      utteranceRef.current.onerror = null;
      utteranceRef.current = null;
    }
    if(resetUIState) {
        setIsSpeaking(false);
        setIsPaused(false);
        setIsLoadingTTS(false);
        setCurrentSentenceIndex(-1);
        setSentenceSegments([]);
    }
  }, [ttsSettings.type]);

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
      const currentSettings = LocalStorage.loadTTSSettings();
      if (!currentSettings.voiceURI && voices.length > 0) {
        const defaultVoice = voices.find(v => v.lang === currentSettings.language && v.default) || voices.find(v => v.lang === currentSettings.language) || voices.find(v => v.default) || voices[0];
        if (defaultVoice) {
            const newSettings = { ...currentSettings, voiceURI: defaultVoice.voiceURI, language: defaultVoice.lang };
            setTtsSettings(newSettings);
            LocalStorage.saveTTSSettings(newSettings);
        }
      } else {
        setTtsSettings(currentSettings);
      }
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
      stopSpeech(true);
    };
  }, [populateVoiceList, stopSpeech]);


  useEffect(() => {
    const player = new Audio();
    audioPlayerRef.current = player;

    const handleAudioEnded = () => stopSpeech(true);
    const handleAudioPlaying = () => {
      if (ttsSettings.type === 'cloud' && isSpeaking) setIsLoadingTTS(false);
    };
    const handleAudioError = () => {
      toast({variant: "destructive", title: "Audio Error", description: "Failed to play audio."});
      stopSpeech(true);
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
      if (audioPlayerRef.current === player) audioPlayerRef.current = null;
    };
  }, [ttsSettings.type, isSpeaking, toast, stopSpeech]);


  const playPauseSpeech = async () => {
    const effectiveTextToRead = window.getSelection()?.toString().trim() || extractedText;

    if (!effectiveTextToRead || effectiveTextToRead.startsWith("Error:") || !loadedDocument || isLoadingDocument) {
      toast({ variant: "destructive", title: "No Text", description: "No valid document text available to read or document is loading." });
      return;
    }

    if (isSpeaking) { 
      if (isPaused) { 
        if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
            if (window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
                setIsPaused(false);
                setTimeout(() => {
                    if (utteranceRef.current && isSpeaking && !isPaused && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
                        stopSpeech(true); 
                    }
                }, 100);
            } else { 
                 stopSpeech(true);
            }
        } else if (ttsSettings.type === 'cloud' && audioPlayerRef.current?.paused) {
          audioPlayerRef.current.play().catch(() => stopSpeech(true));
          setIsPaused(false);
        }
      } else { 
        if (ttsSettings.type === 'local' && typeof window !== 'undefined' && window.speechSynthesis && utteranceRef.current) {
          window.speechSynthesis.pause();
          setIsPaused(true);
        } else if (ttsSettings.type === 'cloud' && audioPlayerRef.current && !audioPlayerRef.current.paused) {
          audioPlayerRef.current.pause();
          setIsPaused(true);
        }
      }
    } else { 
      stopSpeech(false);
      setIsLoadingTTS(true);
      setIsSpeaking(true);
      setIsPaused(false);

      if (ttsSettings.type === 'local') {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
          toast({ variant: "destructive", title: "TTS Error", description: "Browser Speech Synthesis not supported." });
          stopSpeech(true); return;
        }
        const utterance = new SpeechSynthesisUtterance(effectiveTextToRead);
        utterance.lang = ttsSettings.language;
        utterance.pitch = ttsSettings.pitch;
        utterance.rate = ttsSettings.rate;
        const selectedVoice = availableVoices.find(v => v.voiceURI === ttsSettings.voiceURI);
        if (selectedVoice) {
          const browserVoice = window.speechSynthesis.getVoices().find(v => v.voiceURI === selectedVoice.voiceURI);
          if (browserVoice) utterance.voice = browserVoice;
        }
        
        const segments = effectiveTextToRead.match(/[^.!?]+[.!?]*|[^.!?]+/g) || [];
        setSentenceSegments(segments);
        setCurrentSentenceIndex(0);

        utterance.onboundary = (event) => {
            let cumulativeLength = 0;
            for (let i = 0; i < segments.length; i++) {
                if (event.charIndex >= cumulativeLength && event.charIndex < cumulativeLength + segments[i].length) {
                    if (utteranceRef.current === utterance) setCurrentSentenceIndex(i);
                    break;
                }
                cumulativeLength += segments[i].length;
            }
        };
        utterance.onend = () => { if(utteranceRef.current === utterance) stopSpeech(true); };
        utterance.onerror = (event) => {
          if(utteranceRef.current === utterance) {
            toast({ variant: "destructive", title: "TTS Error", description: event.error || "Failed to play speech." });
            stopSpeech(true);
          }
        };
        utteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
        setIsLoadingTTS(false);

      } else { 
        setSentenceSegments([]); 
        setCurrentSentenceIndex(-1);
        try {
          const result = await getCloudSpeech(effectiveTextToRead, ttsSettings.language);
          if ('audioUrl' in result && audioPlayerRef.current) {
            audioPlayerRef.current.src = result.audioUrl;
            await audioPlayerRef.current.play();
          } else if ('error' in result) {
            toast({ variant: "destructive", title: "Cloud TTS Error", description: result.error });
            stopSpeech(true);
          }
        } catch (error: any) {
          toast({ variant: "destructive", title: "Cloud TTS Request Failed", description: error.message || "Unknown error." });
          stopSpeech(true);
        }
      }
    }
  };

  const handleSettingChange = <K extends keyof GlobalTTSSettings>(key: K, value: GlobalTTSSettings[K]) => {
    stopSpeech(true);
    const newSettings = { ...ttsSettings, [key]: value };
    setTtsSettings(newSettings);
    LocalStorage.saveTTSSettings(newSettings); 
     if (key === 'language' && newSettings.type === 'local') {
        const suitableVoice = availableVoices.find(v => v.lang === value && v.default) || availableVoices.find(v => v.lang === value);
        if (suitableVoice) {
            setTtsSettings(prev => ({...prev, voiceURI: suitableVoice.voiceURI}));
            LocalStorage.saveTTSSettings({...newSettings, voiceURI: suitableVoice.voiceURI});
        } else {
            setTtsSettings(prev => ({...prev, voiceURI: undefined}));
            LocalStorage.saveTTSSettings({...newSettings, voiceURI: undefined});
        }
    }
  };
  
  const getButtonState = () => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const canPlay = !!(selectedText || (extractedText && !extractedText.startsWith("Error:") && loadedDocument)) && !isLoadingDocument;

    if (isLoadingTTS) return { text: "Loading...", icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, disabled: true, action: () => {} };
    if (isSpeaking) {
      return isPaused ?
        { text: "Resume", icon: <Play className="mr-1 h-4 w-4" />, disabled: false, action: playPauseSpeech } :
        { text: "Pause", icon: <Pause className="mr-1 h-4 w-4" />, disabled: false, action: playPauseSpeech };
    }
    return { 
        text: selectedText ? "Play Selected" : "Play All", 
        icon: <Play className="mr-1 h-4 w-4" />, 
        disabled: !canPlay, 
        action: playPauseSpeech 
    };
  };

  const buttonState = getButtonState();

  const handleFavoriteSelection = () => {
    const selection = window.getSelection()?.toString().trim();
    if (selection && loadedDocument) {
      const newFavorite: FavoriteItem = {
        id: Date.now().toString(),
        text: selection,
        sourceDocumentId: loadedDocument.id,
        sourceDocumentName: loadedDocument.name,
        createdAt: Date.now(),
      };
      LocalStorage.addFavoriteItem(newFavorite);
      toast({ title: "Favorited!", description: `"${selection.substring(0, 30)}..." added to favorites.` });
    } else if (!selection) {
      toast({ variant: "destructive", title: "No Selection", description: "Please select text to favorite." });
    }
  };


  return (
    <div className="flex flex-col w-full p-4 md:p-6 space-y-6">
      {/* Document Content Area */}
      <div className="flex-grow space-y-6">
        {!docId && !isLoadingDocument && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Info className="text-primary" /> Document Reader</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Please go to your <Button variant="link" className="p-0 h-auto" onClick={() => router.push('/library')}>Library</Button> to select a document to read.</p>
            </CardContent>
          </Card>
        )}

        {isLoadingDocument && docId && (
          <Card>
            <CardContent className="pt-6 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary mr-2" />
              <p>Loading document: {fileName || "Details"}...</p>
            </CardContent>
          </Card>
        )}
        
        {docId && !isLoadingDocument && !loadedDocument && (
           <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><AlertTriangle className="text-destructive" /> Document Not Found</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-destructive-foreground">The document with ID "{docId}" could not be found in your library or failed to load.</p>
              <Button variant="link" onClick={() => router.push('/library')} className="mt-2">Go to Library</Button>
            </CardContent>
          </Card>
        )}

        {loadedDocument && !isLoadingDocument && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="truncate" title={fileName || "Document"}>Document: {fileName || "Untitled"}</CardTitle>
                <CardDescription>Type: {loadedDocument.type.toUpperCase()}</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Text Content</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={cn(
                    "min-h-[200px] max-h-[calc(100vh-30rem)] overflow-y-auto p-3 border rounded-md bg-muted/30 whitespace-pre-wrap text-sm select-text",
                    extractedText.startsWith("Error:") && 'bg-destructive/10 text-destructive-foreground'
                  )}
                >
                  {(ttsSettings.type === 'local' && sentenceSegments.length > 0 && isSpeaking && !isPaused) ? (
                      sentenceSegments.map((segment, index) => (
                        <span
                          key={index}
                          className={cn(
                            "transition-colors duration-150",
                            index === currentSentenceIndex && "bg-accent/20 text-accent-foreground font-semibold"
                          )}
                        >
                          {segment}
                        </span>
                      ))
                    ) : (
                      extractedText || "Text content will appear here..."
                    )
                  }
                </div>
                <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="mt-3">
                  <Star className="mr-2 h-4 w-4" /> Favorite Selected Text
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* TTS Controls Area */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-lg">Text-to-Speech</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div>
              <Label htmlFor="tts-engine" className="text-xs">TTS Engine</Label>
              <Select value={ttsSettings.type} onValueChange={(v) => handleSettingChange('type', v as 'local' | 'cloud')} disabled={(isSpeaking && !isPaused) || !loadedDocument}>
                <SelectTrigger id="tts-engine" className="h-9 text-xs">
                  <SelectValue placeholder="Select engine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local"><div className="flex items-center gap-1 text-xs"><Smartphone className="h-3 w-3" /> Local Browser</div></SelectItem>
                  <SelectItem value="cloud"><div className="flex items-center gap-1 text-xs"><CloudIcon className="h-3 w-3"/> Cloud API</div></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tts-language" className="text-xs">Language (e.g., en-US)</Label>
              <Input
                id="tts-language"
                className="h-9 text-xs"
                value={ttsSettings.language}
                onChange={(e) => handleSettingChange('language', e.target.value)}
                disabled={(isSpeaking && !isPaused) || (ttsSettings.type === 'local' && availableVoices.length === 0) || !loadedDocument}
              />
            </div>

            {ttsSettings.type === 'local' && (
              <div>
                <Label htmlFor="tts-voice" className="text-xs">Voice (Local)</Label>
                <Select
                  value={ttsSettings.voiceURI}
                  onValueChange={(v) => handleSettingChange('voiceURI', v)}
                  disabled={(isSpeaking && !isPaused) || availableVoices.filter(voice => voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 || !loadedDocument}
                >
                  <SelectTrigger id="tts-voice" className="h-9 text-xs">
                    <SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No voices for language"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-48">
                    {availableVoices.filter(voice => voice.lang.startsWith(ttsSettings.language.split('-')[0])).map(voice => (
                      <SelectItem key={voice.voiceURI || voice.name} value={voice.voiceURI} className="text-xs">
                        {voice.name} ({voice.lang}) {voice.default ? "[Def]" : ""}
                      </SelectItem>
                    ))}
                    {availableVoices.filter(voice => voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (
                      <SelectItem value="no-voice-reader" disabled>
                          {availableVoices.length > 0 ? "No voices for language" : "No local voices"}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="tts-rate" className="text-xs">Rate: {ttsSettings.rate.toFixed(1)}</Label>
              <Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={(isSpeaking && !isPaused) || !loadedDocument}/>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tts-pitch" className="text-xs">Pitch: {ttsSettings.pitch.toFixed(1)}</Label>
              <Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={(isSpeaking && !isPaused) || !loadedDocument}/>
            </div>

            <Button 
                onClick={buttonState.action} 
                disabled={buttonState.disabled} 
                variant={isSpeaking && !isPaused ? "outline" : "default"}
                className="w-full h-9 text-sm"
            >
              {buttonState.icon}
              {buttonState.text}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
