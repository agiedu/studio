
import type { MangaDocument, MangaPdfFile, MangaSubPage, TTSSettings } from '@/types';

const PAGES_KEY = 'mangaTalk_documents_v2'; // Updated key for schema change if any
const CURRENT_DOCUMENT_INDEX_KEY = 'mangaTalk_currentDocumentIndex_v2';
const CURRENT_PDF_PAGE_INDEX_KEY = 'mangaTalk_currentPdfPageIndex_v2';
const TTS_SETTINGS_KEY = 'mangaTalk_ttsSettings_v2';

// Helper to safely access localStorage
const safeLocalStorageGet = <T>(key: string, defaultValue: T): T => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.warn(`Error reading localStorage key "${key}":`, error);
    // If parsing fails, it might be due to old incompatible data. Consider clearing or returning default.
    // For now, just returning default to prevent app crash.
    // window.localStorage.removeItem(key); // Optionally clear bad data
    return defaultValue;
  }
};

const safeLocalStorageSet = (key: string, value: any): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Error setting localStorage key "${key}":`, error);
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      alert("Local storage quota exceeded. Unable to save more documents or data. Please clear some documents or browser storage.");
    }
  }
};

export const loadDocuments = (): MangaDocument[] => {
  const docs = safeLocalStorageGet<MangaDocument[]>(PAGES_KEY, []);
  // Ensure processedPages array is initialized correctly for loaded PDF documents
  return docs.map(doc => {
    if (doc.type === 'pdf') {
      const pdfDoc = doc as MangaPdfFile;
      if (pdfDoc.numPages && (!pdfDoc.processedPages || pdfDoc.processedPages.length !== pdfDoc.numPages)) {
        // Ensure processedPages array has the correct length and structure
        const newProcessedPages: (MangaSubPage | null)[] = new Array(pdfDoc.numPages).fill(null);
        if (pdfDoc.processedPages) { // If some pages exist, try to copy them over
            pdfDoc.processedPages.forEach((p, i) => {
            if (i < pdfDoc.numPages) {
                // Ensure each subpage has the required fields, even if empty/undefined from older versions
                newProcessedPages[i] = {
                    imageDataUrl: p?.imageDataUrl || '',
                    extractedText: p?.extractedText // Keep as undefined if it was
                };
            }
            });
        }
        doc = { ...pdfDoc, processedPages: newProcessedPages.map(p => p ? p : {imageDataUrl: '', extractedText: undefined}) as MangaSubPage[]};
      } else if (pdfDoc.numPages && pdfDoc.processedPages) {
        // Ensure existing processed pages have the correct structure
         doc = {
          ...pdfDoc,
          processedPages: pdfDoc.processedPages.map(p => ({
            imageDataUrl: p?.imageDataUrl || '',
            extractedText: p?.extractedText
          }))
        } as MangaPdfFile;
      }
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
  language: 'en-US', // Default language
  rate: 1,
  pitch: 1,
  voiceURI: undefined, // Ensure voiceURI can be undefined initially
};
export const loadTTSSettings = (): TTSSettings => {
  const settings = safeLocalStorageGet<TTSSettings>(TTS_SETTINGS_KEY, defaultTTSSettings);
  // Ensure all keys from defaultTTSSettings are present
  return { ...defaultTTSSettings, ...settings };
};
export const saveTTSSettings = (settings: TTSSettings): void => safeLocalStorageSet(TTS_SETTINGS_KEY, settings);

// Night mode is handled by AppHeader, keeping these for potential future use if explicit state is needed.
const NIGHT_MODE_KEY = 'mangaTalk_nightMode_v2';
export const loadNightMode = (): boolean => safeLocalStorageGet<boolean>(NIGHT_MODE_KEY, true);
export const saveNightMode = (isNightMode: boolean): void => safeLocalStorageSet(NIGHT_MODE_KEY, isNightMode);

