
export interface MangaSubPage {
  imageDataUrl: string;
  extractedText?: string;
}

export interface MangaFile {
  id: string; // For in-app identification, typically a timestamp or UUID
  title?: string; // Original file name
  type: 'image' | 'pdf';
  fileData: ArrayBuffer; // Store actual file content for IndexedDB
  originalType: string; // e.g., 'image/png', 'application/pdf'
  createdAt: number;
}

export interface MangaImageFile extends MangaFile {
  type: 'image';
  imageDataUrl?: string; // Can be generated from fileData on demand, or stored if small
  extractedText?: string;
}

export interface MangaPdfFile extends MangaFile {
  type: 'pdf';
  // pdfDataUrl is removed as fileData holds the ArrayBuffer
  numPages: number;
  processedPages: MangaSubPage[]; // These are for display, not primary storage of PDF pages themselves from original file
}

// This will be the primary type stored in IndexedDB
export type StoredMangaDocument = Omit<MangaImageFile, 'processedPages' | 'numPages'> | Omit<MangaPdfFile, 'processedPages'> & { numPages?: number };


export interface TTSSettings {
  type: 'local' | 'cloud';
  voiceURI?: string;
  language: string;
  rate: number;
  pitch: number;
  engine?: 'local' | 'cloud';
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
  sourceDocumentId?: string; // This would be the ID from IndexedDB
  sourceDocumentName?: string;
  createdAt: number;
}

// For active document state in MangaRoom, similar to StoredMangaDocument but might include transient display data
export type ActiveMangaDocument = MangaImageFile | MangaPdfFile;
