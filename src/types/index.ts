
export interface MangaSubPage { 
  imageDataUrl: string; 
  extractedText?: string; // Can be undefined if OCR fails or not yet run
}

export interface MangaFile {
  id: string;
  title?: string; 
  type: 'image' | 'pdf';
}

export interface MangaImageFile extends MangaFile {
  type: 'image';
  imageDataUrl: string; 
  extractedText?: string;
}

export interface MangaPdfFile extends MangaFile {
  type: 'pdf';
  pdfDataUrl: string; 
  numPages: number;
  // processedPages will always be an array of MangaSubPage.
  // If a page hasn't been processed, its imageDataUrl might be empty and extractedText undefined.
  processedPages: MangaSubPage[]; 
}

export type MangaDocument = MangaImageFile | MangaPdfFile;

export interface TTSSettings {
  type: 'local' | 'cloud';
  voiceURI?: string; 
  language: string;
  rate: number; 
  pitch: number; 
}

export interface TTSVoice {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default: boolean;
}

