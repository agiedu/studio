

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

// New types for Library and Favorites
export type StoredDocumentType = 'txt' | 'pdf';

export interface BaseStoredDocument {
  id: string;
  name: string;
  type: StoredDocumentType;
  createdAt: number;
}

export interface StoredTxtDocument extends BaseStoredDocument {
  type: 'txt';
  textContent: string;
}

export interface StoredPdfDocument extends BaseStoredDocument {
  type: 'pdf';
  pdfBase64: string; // Store PDF as base64 encoded string
}

export type StoredDocument = StoredTxtDocument | StoredPdfDocument;

export interface FavoriteItem {
  id: string;
  text: string;
  sourceDocumentId?: string; // Optional: link back to the document it came from
  sourceDocumentName?: string;
  createdAt: number;
}
