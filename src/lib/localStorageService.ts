
import type { MangaDocument, MangaPdfFile, MangaSubPage, TTSSettings } from '@/types';

const PAGES_KEY = 'mangaTalk_documents_v2';
const CURRENT_DOCUMENT_INDEX_KEY = 'mangaTalk_currentDocumentIndex_v2';
const PDF_DOCUMENT_PAGE_STATES_KEY = 'mangaTalk_pdfDocumentPageStates_v2'; // New key for per-document PDF page states
const TTS_SETTINGS_KEY = 'mangaTalk_ttsSettings_v2';
const NIGHT_MODE_KEY = 'mangaTalk_nightMode_v2';

// Helper to safely access localStorage
const safeLocalStorageGet = <T>(key: string, defaultValue: T): T => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.warn(`Error reading localStorage key "${key}":`, error);
    // window.localStorage.removeItem(key); 
    return defaultValue;
  }
};

const safeLocalStorageSet = (key: string, value: any): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Error setting localStorage key "${key}":`, error);
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.message.toLowerCase().includes('quota'))) {
      alert("Local storage quota exceeded. Unable to save more data. Please clear some documents or browser storage.");
    }
  }
};

export const loadDocuments = (): MangaDocument[] => {
  const docs = safeLocalStorageGet<MangaDocument[]>(PAGES_KEY, []);
  return docs.map(doc => {
    if (doc.type === 'pdf') {
      const pdfDoc = doc as MangaPdfFile;
      if (!pdfDoc.processedPages || pdfDoc.processedPages.length !== pdfDoc.numPages) {
        const newProcessedPages: MangaSubPage[] = new Array(pdfDoc.numPages).fill(null).map(() => ({ imageDataUrl: '', extractedText: undefined }));
        if (pdfDoc.processedPages) {
          pdfDoc.processedPages.forEach((p, i) => {
            if (i < pdfDoc.numPages && p) {
              newProcessedPages[i] = {
                imageDataUrl: p.imageDataUrl || '',
                extractedText: p.extractedText
              };
            }
          });
        }
        return { ...pdfDoc, processedPages: newProcessedPages };
      } else {
         return {
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

// Per-document PDF page state functions
type PdfDocumentPageStates = { [docId: string]: number };

export const loadCurrentPdfPageIndexForDoc = (docId: string): number | undefined => {
  if (!docId) return undefined;
  const states = safeLocalStorageGet<PdfDocumentPageStates>(PDF_DOCUMENT_PAGE_STATES_KEY, {});
  return states[docId];
};

export const saveCurrentPdfPageIndexForDoc = (docId: string, pageIndex: number): void => {
  if (!docId) return;
  const states = safeLocalStorageGet<PdfDocumentPageStates>(PDF_DOCUMENT_PAGE_STATES_KEY, {});
  states[docId] = pageIndex;
  safeLocalStorageSet(PDF_DOCUMENT_PAGE_STATES_KEY, states);
};

export const removeCurrentPdfPageIndexForDoc = (docId: string): void => {
  if (!docId) return;
  const states = safeLocalStorageGet<PdfDocumentPageStates>(PDF_DOCUMENT_PAGE_STATES_KEY, {});
  delete states[docId];
  safeLocalStorageSet(PDF_DOCUMENT_PAGE_STATES_KEY, states);
};


export const defaultTTSSettings: TTSSettings = {
  type: 'local',
  language: 'en-US',
  rate: 1,
  pitch: 1,
  voiceURI: undefined,
};
export const loadTTSSettings = (): TTSSettings => {
  const settings = safeLocalStorageGet<TTSSettings>(TTS_SETTINGS_KEY, defaultTTSSettings);
  return { ...defaultTTSSettings, ...settings };
};
export const saveTTSSettings = (settings: TTSSettings): void => safeLocalStorageSet(TTS_SETTINGS_KEY, settings);

export const loadNightMode = (): boolean => safeLocalStorageGet<boolean>(NIGHT_MODE_KEY, true);
export const saveNightMode = (isNightMode: boolean): void => safeLocalStorageSet(NIGHT_MODE_KEY, isNightMode);
