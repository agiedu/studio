

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
  pdfDataUrl: string; // Full data URI for the PDF
  numPages: number;
  processedPages: MangaSubPage[];
}

export type MangaDocument = MangaImageFile | MangaPdfFile;

export interface TTSSettings {
  type: 'local' | 'cloud';
  voiceURI?: string;
  language: string;
  rate: number;
  pitch: number;
  // For Favorites page, add engine property
  engine?: 'local' | 'cloud';
}

export interface TTSVoice {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default: boolean;
}

// Types for Library and Favorites
export type StoredDocumentType = 'txt' | 'pdf' | 'image';

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
  pdfBase64: string; // Store PDF as base64 encoded string (the data part only)
}

export interface StoredImageDocument extends BaseStoredDocument {
  type: 'image';
  imageDataUrl: string; // Store full image data URI
  extractedText?: string; // To store OCR text for images from MangaRoom
}

export type StoredDocument = StoredTxtDocument | StoredPdfDocument | StoredImageDocument;

export interface FavoriteItem {
  id: string;
  text: string;
  sourceDocumentId?: string;
  sourceDocumentName?: string;
  createdAt: number;
}

// Type specifically for Read2 stored documents, which might evolve
// For now, it's the same as StoredDocument, but images will have extractedText
export type Read2StoredDocument = StoredImageDocument | StoredPdfDocument;

