export interface MangaPage {
  id: string;
  imageDataUrl: string;
  extractedText?: string;
  title?: string; // Optional: title for the page/image file name
}

export interface TTSSettings {
  type: 'local' | 'cloud';
  voiceURI?: string; // For local TTS, using voiceURI
  language: string;
  rate: number; // 0.1 to 10
  pitch: number; // 0 to 2
}

export interface TTSVoice {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default: boolean;
}
