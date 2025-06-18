

import type { MangaDocument, MangaPdfFile, MangaSubPage, TTSSettings, StoredDocument, FavoriteItem, StoredImageDocument, StoredPdfDocument, StoredTxtDocument } from '@/types';

const PDF_MANGA_DOCUMENT_PAGE_STATES_KEY = 'mangaTalk_pdfDocumentPageStates_v2';
const TTS_SETTINGS_KEY = 'mangaTalk_ttsSettings_v2';
const NIGHT_MODE_KEY = 'mangaTalk_nightMode_v2';

const STORED_DOCUMENTS_KEY = 'mangaTalk_storedDocuments_v1';
const FAVORITE_ITEMS_KEY = 'mangaTalk_favoriteItems_v1';
const LAST_ACTIVE_MANGAROOM_DOC_ID_KEY = 'mangaTalk_lastActiveMangaRoomDocId_v1';


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

// MangaRoom specific storage for its *active PDF's page index*
export const loadCurrentPdfPageIndexForDoc = (docId: string): number | undefined => {
  if (!docId) return undefined;
  const states = safeLocalStorageGet<{ [docId: string]: number }>(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, {});
  return states[docId];
};

export const saveCurrentPdfPageIndexForDoc = (docId: string, pageIndex: number): void => {
  if (!docId) return;
  const states = safeLocalStorageGet<{ [docId: string]: number }>(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, {});
  states[docId] = pageIndex;
  safeLocalStorageSet(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, states);
};


// TTS Settings (shared)
export const defaultTTSSettings: TTSSettings = {
  type: 'local',
  language: 'en-US',
  rate: 1,
  pitch: 1,
  voiceURI: undefined,
  engine: 'local', 
};
export const loadTTSSettings = (): TTSSettings => {
  const settings = safeLocalStorageGet<TTSSettings>(TTS_SETTINGS_KEY, defaultTTSSettings);
  const completeSettings = { ...defaultTTSSettings, ...settings };
  if (!completeSettings.engine) {
    completeSettings.engine = defaultTTSSettings.engine;
  }
  return completeSettings;
};
export const saveTTSSettings = (settings: TTSSettings): void => safeLocalStorageSet(TTS_SETTINGS_KEY, settings);

// Night Mode (shared)
export const loadNightMode = (): boolean => safeLocalStorageGet<boolean>(NIGHT_MODE_KEY, true);
export const saveNightMode = (isNightMode: boolean): void => safeLocalStorageSet(NIGHT_MODE_KEY, isNightMode);

// Library Page specific storage (StoredDocument - shared by MangaRoom for saving)
export const loadStoredDocuments = (): StoredDocument[] => {
    return safeLocalStorageGet<StoredDocument[]>(STORED_DOCUMENTS_KEY, []);
};

export const saveStoredDocuments = (documents: StoredDocument[]): void => {
    safeLocalStorageSet(STORED_DOCUMENTS_KEY, documents);
};

export const addStoredDocument = (document: StoredDocument): void => {
    const documents = loadStoredDocuments();
    // Prevent duplicates by ID
    if (documents.find(d => d.id === document.id)) {
        console.warn(`Document with ID ${document.id} already exists in library. Updating existing.`);
        const updatedDocuments = documents.map(d => d.id === document.id ? document : d);
        saveStoredDocuments(updatedDocuments);
        return;
    }
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

// Favorites Page specific storage (FavoriteItem - shared)
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

// For MangaRoom to remember its last active document from the Library
export const saveLastActiveMangaRoomDocId = (docId: string | null): void => {
  safeLocalStorageSet(LAST_ACTIVE_MANGAROOM_DOC_ID_KEY, docId);
};

export const loadLastActiveMangaRoomDocId = (): string | null => {
  return safeLocalStorageGet<string | null>(LAST_ACTIVE_MANGAROOM_DOC_ID_KEY, null);
};

