

import type { MangaDocument, MangaPdfFile, MangaSubPage, TTSSettings, StoredDocument, FavoriteItem } from '@/types';

const MANGA_DOCUMENTS_KEY = 'mangaTalk_documents_v2';
const CURRENT_MANGA_DOCUMENT_INDEX_KEY = 'mangaTalk_currentDocumentIndex_v2';
const PDF_MANGA_DOCUMENT_PAGE_STATES_KEY = 'mangaTalk_pdfDocumentPageStates_v2';
const TTS_SETTINGS_KEY = 'mangaTalk_ttsSettings_v2';
const NIGHT_MODE_KEY = 'mangaTalk_nightMode_v2';

const STORED_DOCUMENTS_KEY = 'mangaTalk_storedDocuments_v1';
const FAVORITE_ITEMS_KEY = 'mangaTalk_favoriteItems_v1';


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
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.message.toLowerCase().includes('quota'))) {
      alert("Local storage quota exceeded. Unable to save more data. Please clear some documents or browser storage.");
    }
  }
};

// MangaRoom specific storage
export const loadDocuments = (): MangaDocument[] => {
  const docs = safeLocalStorageGet<MangaDocument[]>(MANGA_DOCUMENTS_KEY, []);
  return docs.map(doc => {
    if (doc.type === 'pdf') {
      const pdfDoc = doc as MangaPdfFile;
      const expectedPagesLength = pdfDoc.numPages || 0;
      if (!pdfDoc.processedPages || pdfDoc.processedPages.length !== expectedPagesLength) {
        const newProcessedPages: MangaSubPage[] = new Array(expectedPagesLength).fill(null).map(() => ({ imageDataUrl: '', extractedText: undefined }));
        if (pdfDoc.processedPages) {
          pdfDoc.processedPages.forEach((p, i) => {
            if (i < expectedPagesLength && p) {
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
export const saveDocuments = (docs: MangaDocument[]): void => safeLocalStorageSet(MANGA_DOCUMENTS_KEY, docs);

export const loadCurrentDocumentIndex = (): number => safeLocalStorageGet<number>(CURRENT_MANGA_DOCUMENT_INDEX_KEY, 0);
export const saveCurrentDocumentIndex = (index: number): void => safeLocalStorageSet(CURRENT_MANGA_DOCUMENT_INDEX_KEY, index);

type PdfDocumentPageStates = { [docId: string]: number };

export const loadCurrentPdfPageIndexForDoc = (docId: string): number | undefined => {
  if (!docId) return undefined;
  const states = safeLocalStorageGet<PdfDocumentPageStates>(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, {});
  return states[docId];
};

export const saveCurrentPdfPageIndexForDoc = (docId: string, pageIndex: number): void => {
  if (!docId) return;
  const states = safeLocalStorageGet<PdfDocumentPageStates>(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, {});
  states[docId] = pageIndex;
  safeLocalStorageSet(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, states);
};

export const removeCurrentPdfPageIndexForDoc = (docId: string): void => {
  if (!docId) return;
  const states = safeLocalStorageGet<PdfDocumentPageStates>(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, {});
  delete states[docId];
  safeLocalStorageSet(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, states);
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

// Library Page specific storage (StoredDocument)
export const loadStoredDocuments = (): StoredDocument[] => {
    return safeLocalStorageGet<StoredDocument[]>(STORED_DOCUMENTS_KEY, []);
};

export const saveStoredDocuments = (documents: StoredDocument[]): void => {
    safeLocalStorageSet(STORED_DOCUMENTS_KEY, documents);
};

export const addStoredDocument = (document: StoredDocument): void => {
    const documents = loadStoredDocuments();
    documents.unshift(document); // Add to the beginning
    saveStoredDocuments(documents);
};

export const deleteStoredDocument = (docId: string): void => {
    let documents = loadStoredDocuments();
    documents = documents.filter(doc => doc.id !== docId);
    saveStoredDocuments(documents);
};

export const getStoredDocumentById = (docId: string): StoredDocument | undefined => {
    const documents = loadStoredDocuments();
    return documents.find(doc => doc.id === docId);
};

// Favorites Page specific storage (FavoriteItem)
export const loadFavoriteItems = (): FavoriteItem[] => {
    return safeLocalStorageGet<FavoriteItem[]>(FAVORITE_ITEMS_KEY, []);
};

export const saveFavoriteItems = (items: FavoriteItem[]): void => {
    safeLocalStorageSet(FAVORITE_ITEMS_KEY, items);
};

export const addFavoriteItem = (item: FavoriteItem): void => {
    const items = loadFavoriteItems();
    items.unshift(item); // Add to the beginning
    saveFavoriteItems(items);
};

export const deleteFavoriteItem = (itemId: string): void => {
    let items = loadFavoriteItems();
    items = items.filter(item => item.id !== itemId);
    saveFavoriteItems(items);
};

export const getFavoriteItemById = (itemId: string): FavoriteItem | undefined => {
    const items = loadFavoriteItems();
    return items.find(item => item.id === itemId);
};
