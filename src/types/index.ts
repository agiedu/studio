export interface MangaSubPage { // Represents a single visual page (image or rendered PDF page)
  imageDataUrl: string; // This will be the image data URL for images, or rendered PDF page data URL
  extractedText?: string;
}

export interface MangaFile {
  id: string;
  title?: string; // Original file name
  type: 'image' | 'pdf';
}

export interface MangaImageFile extends MangaFile {
  type: 'image';
  imageDataUrl: string; // For direct image uploads
  extractedText?: string;
}

export interface MangaPdfFile extends MangaFile {
  type: 'pdf';
  pdfDataUrl: string; // Store the original PDF data URL (e.g., from FileReader)
  numPages: number;
  // Stores pages as they are rendered and OCR'd. Indexed by page number (0-based).
  // A page might be null if not yet processed.
  processedPages: (MangaSubPage | null)[];
}

export type MangaDocument = MangaImageFile | MangaPdfFile;

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
