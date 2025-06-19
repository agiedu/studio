
export interface MangaSubPage { // Primarily for PDF pages rendered as images
  imageDataUrl: string;
  extractedText?: string;
}

// Base for all stored documents
export interface StoredDocumentBase {
  id: string;
  title: string; // Original file name will be used as title
  fileData: ArrayBuffer; // Store actual file content
  originalType: string; // e.g., 'image/png', 'application/pdf', 'application/epub+zip', 'text/plain'
  createdAt: number;
}

export interface StoredImageDocument extends StoredDocumentBase {
  type: 'image';
  extractedText?: string; // For OCR'd text
}

export interface StoredPdfDocument extends StoredDocumentBase {
  type: 'pdf';
  numPages?: number;
  ocrTextPerPage?: { [pageNumber: number]: string }; // Added to store OCR text per page
  // For PDF, text extraction will be on-the-fly in the reader or pre-extracted per page if complex.
  // We won't store all 'processedPages' with image data here to save space in IndexedDB.
  // The reader will generate page images as needed.
}

export interface StoredEpubDocument extends StoredDocumentBase {
  type: 'epub';
  // epub.js works directly with the ArrayBuffer (fileData)
}

export interface StoredMobiDocument extends StoredDocumentBase {
  type: 'mobi';
  // Placeholder; direct rendering is complex.
}

export interface StoredTxtDocument extends StoredDocumentBase {
  type: 'txt';
  // fileData (ArrayBuffer) will be decoded to text in the reader.
}

export type StoredMangaDocument =
  | StoredImageDocument
  | StoredPdfDocument
  | StoredEpubDocument
  | StoredMobiDocument
  | StoredTxtDocument;


export interface TTSSettings {
  type: 'local' | 'cloud';
  voiceURI?: string;
  language: string;
  rate: number;
  pitch: number;
  engine?: 'local' | 'cloud'; // engine can be derived from type, or explicit
}

export interface TTSVoice {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default: boolean;
}

export interface FavoriteItem {
  id: string;
  text: string;
  sourceDocumentId?: string;
  sourceDocumentName?: string;
  createdAt: number;
}

// This type might be used by the ReaderPage to hold the currently active document
// It could be identical to StoredMangaDocument or have additional transient reader state
export type ActiveMangaDocument = StoredMangaDocument & {
  // Example of transient state, could be managed within ReaderPage's component state
  // currentPdfPageImage?: string;
  // currentEpubBookInstance?: any; // epub.js Book instance
};
