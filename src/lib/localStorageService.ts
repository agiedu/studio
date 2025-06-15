import type { MangaDocument, TTSSettings } from '@/types';

const PAGES_KEY = 'mangaTalk_documents'; // Renamed key
const CURRENT_DOCUMENT_INDEX_KEY = 'mangaTalk_currentDocumentIndex';
const CURRENT_PDF_PAGE_INDEX_KEY = 'mangaTalk_currentPdfPageIndex';
const TTS_SETTINGS_KEY = 'mangaTalk_ttsSettings';

// Helper to safely access localStorage
const safeLocalStorageGet = <T>(key: string, defaultValue: T): T => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.warn(`Error reading localStorage key "${key}":`, error);
    return defaultValue;
  }
};

const safeLocalStorageSet = (key: string, value: any): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Error setting localStorage key "${key}":`, error);
  }
};

export const loadDocuments = (): MangaDocument[] => {
  const docs = safeLocalStorageGet<MangaDocument[]>(PAGES_KEY, []);
  // Ensure processedPages array is initialized for loaded PDF documents
  return docs.map(doc => {
    if (doc.type === 'pdf' && doc.numPages && !doc.processedPages) {
      doc.processedPages = new Array(doc.numPages).fill(null);
    } else if (doc.type === 'pdf' && doc.numPages && doc.processedPages.length !== doc.numPages) {
      // Fix array length if mismatched
      const newProcessedPages = new Array(doc.numPages).fill(null);
      doc.processedPages.forEach((p, i) => {
        if (i < doc.numPages) newProcessedPages[i] = p;
      });
      doc.processedPages = newProcessedPages;
    }
    return doc;
  });
};
export const saveDocuments = (docs: MangaDocument[]): void => safeLocalStorageSet(PAGES_KEY, docs);

export const loadCurrentDocumentIndex = (): number => safeLocalStorageGet<number>(CURRENT_DOCUMENT_INDEX_KEY, 0);
export const saveCurrentDocumentIndex = (index: number): void => safeLocalStorageSet(CURRENT_DOCUMENT_INDEX_KEY, index);

export const loadCurrentPdfPageIndex = (): number => safeLocalStorageGet<number>(CURRENT_PDF_PAGE_INDEX_KEY, 0);
export const saveCurrentPdfPageIndex = (index: number): void => safeLocalStorageSet(CURRENT_PDF_PAGE_INDEX_KEY, index);


export const defaultTTSSettings: TTSSettings = {
  type: 'local',
  language: 'en-US',
  rate: 1,
  pitch: 1,
};
export const loadTTSSettings = (): TTSSettings => safeLocalStorageGet<TTSSettings>(TTS_SETTINGS_KEY, defaultTTSSettings);
export const saveTTSSettings = (settings: TTSSettings): void => safeLocalStorageSet(TTS_SETTINGS_KEY, settings);

// Night mode is handled by AppHeader, keeping these for potential future use if explicit state is needed.
const NIGHT_MODE_KEY = 'mangaTalk_nightMode';
export const loadNightMode = (): boolean => safeLocalStorageGet<boolean>(NIGHT_MODE_KEY, true);
export const saveNightMode = (isNightMode: boolean): void => safeLocalStorageSet(NIGHT_MODE_KEY, isNightMode);
