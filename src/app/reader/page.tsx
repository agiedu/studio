
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Loader2, Play, Pause, Smartphone, Cloud as CloudIcon, Info, Star, AlertTriangle } from 'lucide-react';
import { getCloudSpeech } from '@/app/actions';
import * as LocalStorageService from '@/lib/localStorageService';
import * as IndexedDBService from '@/lib/indexedDBService';
import type { TTSSettings, TTSVoice, FavoriteItem, StoredMangaDocument } from '@/types';
import { cn } from '@/lib/utils';


export default function ReaderPage() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [documentTitle, setDocumentTitle] = useState<string | null>(null);
  const [docIdFromQuery, setDocIdFromQuery] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<string>("");
  const [isLoadingTTS, setIsLoadingTTS] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  const [ttsSettings, setTtsSettings] = useState<TTSSettings>(LocalStorageService.defaultTTSSettings);
  const [availableVoices, setAvailableVoices] = useState<TTSVoice[]>([]);

  const [sentenceSegments, setSentenceSegments] = useState<string[]>([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number>(-1);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const docId = searchParams.get('docId');
    setDocIdFromQuery(docId);

    if (docId) {
      IndexedDBService.getDocumentById(docId)
        .then(doc => {
          if (doc) {
            setDocumentTitle(doc.title || 'Untitled Document');
            if (doc.type === 'image' && doc.extractedText) {
              setExtractedText(doc.extractedText);
            } else if (doc.type === 'pdf') {
              // For PDFs on this simplified reader, we assume text might be manually pasted
              // or a future enhancement could load specific page text.
              // For now, indicate that PDF text needs to be handled via Read2 page or manual paste.
              setExtractedText(`PDF "${doc.title || ''}" loaded. Use Read2 page for full PDF viewing and page-by-page text extraction. You can also paste text here manually.`);
            } else if (doc.type === 'image' && !doc.extractedText) {
              setExtractedText(`Image "${doc.title || ''}" loaded. OCR text not found. Use Read2 page to perform OCR if needed or paste text here.`);
            }
            else {
               setExtractedText("Document loaded, but no directly readable text found for this view. Paste text below or use Read2 page for images/PDFs.");
            }
          } else {
            toast({ variant: "destructive", title: "Document Not Found", description: `Document with ID "${docId}" not found in browser storage.` });
            setExtractedText("Error: Document not found. Please select a document from the Library or use the Read2 page.");
          }
        })
        .catch(err => {
          toast({ variant: "destructive", title: "Error Loading Document", description: err.message });
          setExtractedText(`Error loading document: ${err.message}`);
        });
    } else {
      setExtractedText("No document selected. Paste text below to read, or open a document from your Library to load its text (if available). For full PDF/Image processing, use the 'Read2' page.");
    }
  }, [searchParams, toast]);


  useEffect(() => {
    if (typeof window !== 'undefined') {
      setTtsSettings(LocalStorageService.loadTTSSettings());
    }
  }, []);


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
      const currentSettings = LocalStorageService.loadTTSSettings();
      if (!currentSettings.voiceURI && voices.length > 0) {
        const defaultVoice = voices.find(v => v.lang === currentSettings.language && v.default) || voices.find(v => v.lang === currentSettings.language) || voices.find(v => v.default) || voices[0];
        if (defaultVoice) {
            const newSettings = { ...currentSettings, voiceURI: defaultVoice.voiceURI, language: defaultVoice.lang };
            setTtsSettings(newSettings); // This will trigger the useEffect for saving
        }
      } else {
        setTtsSettings(currentSettings); // Ensure settings are loaded
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

 useEffect(() => {
    LocalStorageService.saveTTSSettings(ttsSettings);
  }, [ttsSettings]);


  const playPauseSpeech = async () => {
    const selectedTextFromSelection = window.getSelection()?.toString().trim();
    const effectiveTextToRead = selectedTextFromSelection || extractedText;

    if (!effectiveTextToRead || effectiveTextToRead.startsWith("Error:") || effectiveTextToRead.startsWith("PDF") || effectiveTextToRead.startsWith("Image") || effectiveTextToRead.startsWith("No document selected") || effectiveTextToRead.startsWith("Document loaded, but no directly readable text")) {
      toast({ variant: "destructive", title: "No Text", description: "No valid text available to read. Paste text or ensure a document with extracted text is loaded." });
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

  const handleSettingChange = <K extends keyof TTSSettings>(key: K, value: TTSSettings[K]) => {
    stopSpeech(true);
    setTtsSettings(prev => {
        const newSettings = { ...prev, [key]: value };
        if (key === 'language' && newSettings.type === 'local') {
            const suitableVoice = availableVoices.find(v => v.lang === value && v.default) || availableVoices.find(v => v.lang === value);
            if (suitableVoice) {
                newSettings.voiceURI = suitableVoice.voiceURI;
            } else {
                newSettings.voiceURI = undefined;
            }
        }
        return newSettings;
    });
  };

  const getButtonState = () => {
    const selectedText = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : '';
    const canPlay = !!(selectedText || (extractedText && !extractedText.startsWith("Error:") && !extractedText.startsWith("PDF") && !extractedText.startsWith("Image") && !extractedText.startsWith("No document selected") && !extractedText.startsWith("Document loaded, but no directly readable text")));

    if (isLoadingTTS) return { text: "Loading...", icon: <Loader2 className="mr-1 h-4 w-4 animate-spin" />, disabled: true, action: () => {} };
    if (isSpeaking) {
      return isPaused ?
        { text: "Resume", icon: <Play className="mr-1 h-4 w-4" />, disabled: false, action: playPauseSpeech } :
        { text: "Pause", icon: <Pause className="mr-1 h-4 w-4" />, disabled: false, action: playPauseSpeech };
    }
    return {
        text: selectedText ? "Play Selected" : "Play Text Below",
        icon: <Play className="mr-1 h-4 w-4" />,
        disabled: !canPlay,
        action: playPauseSpeech
    };
  };

  const buttonState = getButtonState();

  const handleFavoriteSelection = () => {
    const selection = window.getSelection()?.toString().trim() || extractedText; // Favorite all if no selection
    if (selection && !selection.startsWith("Error:") && !selection.startsWith("PDF") && !selection.startsWith("Image") && !selection.startsWith("No document selected") && !selection.startsWith("Document loaded, but no directly readable text")) {
      const newFavorite: FavoriteItem = {
        id: Date.now().toString(),
        text: selection,
        sourceDocumentId: docIdFromQuery || "reader_pasted_text",
        sourceDocumentName: documentTitle || "Pasted Text (Reader Page)",
        createdAt: Date.now(),
      };
      LocalStorageService.addFavoriteItem(newFavorite);
      toast({ title: "Favorited!", description: `"${selection.substring(0, 50)}..." added to favorites.` });
    } else {
      toast({ variant: "destructive", title: "No Valid Text", description: "Please ensure there is valid text in the textarea or selected to favorite." });
    }
  };


  return (
    <div className="flex flex-col w-full p-4 md:p-6 space-y-6">
      <div className="flex-grow space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Info className="text-primary" /> Text Reader</CardTitle>
              <CardDescription>
                This page is for Text-to-Speech. {docIdFromQuery ? `Document: "${documentTitle || 'Loading...'}" is loaded. ` : ''}
                You can paste text into the area below, or open a document from the Library to load its text content here (if available).
                For full PDF/Image viewing and OCR, please use the "Read2" page.
              </CardDescription>
            </CardHeader>
          </Card>
            <Card>
              <CardHeader>
                <CardTitle>{documentTitle ? `Text from: ${documentTitle}` : "Text Content"}</CardTitle>
                 <CardDescription>
                   {docIdFromQuery ? `Content of "${documentTitle || 'document'}". ` : ""}
                   Paste text below or select text on the page to read.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(extractedText.startsWith("PDF") || extractedText.startsWith("Image") || extractedText.startsWith("Document loaded, but no directly readable text")) && (
                    <div className="mb-3 p-3 border border-amber-500 bg-amber-50 rounded-md text-amber-700 text-sm">
                        <div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5"/> Note:</div>
                        {extractedText}
                    </div>
                )}
                <textarea
                  value={extractedText}
                  onChange={(e) => {
                    stopSpeech(true);
                    setExtractedText(e.target.value);
                    setDocumentTitle("Manually Entered Text"); // Indicate text is now manual
                    setDocIdFromQuery(null); // Clear doc association if text is manually changed
                  }}
                  placeholder="Paste text here to read aloud..."
                  className={cn(
                    "min-h-[200px] w-full max-h-[calc(100vh-30rem)] overflow-y-auto p-3 border rounded-md bg-muted/30 whitespace-pre-wrap text-sm select-text focus:ring-primary focus:border-primary",
                    extractedText.startsWith("Error:") && 'bg-destructive/10 text-destructive-foreground'
                  )}
                  readOnly={!!docIdFromQuery && (extractedText.startsWith("PDF") || extractedText.startsWith("Image") || extractedText.startsWith("Document loaded, but no directly readable text"))} // Make readonly if it's a placeholder message for a loaded doc
                />
                <Button onClick={handleFavoriteSelection} variant="outline" size="sm" className="mt-3">
                  <Star className="mr-2 h-4 w-4" /> Favorite Text Above
                </Button>
              </CardContent>
            </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-lg">Text-to-Speech Controls</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div>
              <Label htmlFor="tts-engine" className="text-xs">TTS Engine</Label>
              <Select value={ttsSettings.type} onValueChange={(v) => handleSettingChange('type', v as 'local' | 'cloud')} disabled={(isSpeaking && !isPaused)}>
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
                disabled={(isSpeaking && !isPaused) || (ttsSettings.type === 'local' && availableVoices.length === 0)}
              />
            </div>

            {ttsSettings.type === 'local' && (
              <div>
                <Label htmlFor="tts-voice" className="text-xs">Voice (Local)</Label>
                <Select
                  value={ttsSettings.voiceURI || ""}
                  onValueChange={(v) => handleSettingChange('voiceURI', v)}
                  disabled={(isSpeaking && !isPaused) || availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0}
                >
                  <SelectTrigger id="tts-voice" className="h-9 text-xs">
                    <SelectValue placeholder={availableVoices.length > 0 ? "Select voice" : "No voices for language"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-48">
                    {availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).map(voice => (
                      <SelectItem key={voice.voiceURI || voice.name} value={voice.voiceURI} className="text-xs">
                        {voice.name} ({voice.lang}) {voice.default ? "[Def]" : ""}
                      </SelectItem>
                    ))}
                    {availableVoices.filter(voice => voice.lang && voice.lang.startsWith(ttsSettings.language.split('-')[0])).length === 0 && (
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
              <Slider id="tts-rate" min={0.5} max={2} step={0.1} value={[ttsSettings.rate]} onValueChange={([v]) => handleSettingChange('rate', v)} disabled={(isSpeaking && !isPaused)}/>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tts-pitch" className="text-xs">Pitch: {ttsSettings.pitch.toFixed(1)}</Label>
              <Slider id="tts-pitch" min={0} max={2} step={0.1} value={[ttsSettings.pitch]} onValueChange={([v]) => handleSettingChange('pitch', v)} disabled={(isSpeaking && !isPaused)}/>
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
