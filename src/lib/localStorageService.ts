
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

const safeLocalStorageSet = (key: string, value: any): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error: any) {
    let specificMessage = `Error setting localStorage key "${key}"`;
    // DOMException error codes for quota exceeded can vary slightly by browser
    // Common ones are 22 (Chrome), 1014 (Firefox for NS_ERROR_DOM_QUOTA_REACHED)
    // Checking name and message is generally more robust.
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || (error.message && error.message.toLowerCase().includes('quota')))) {
      specificMessage = `QuotaExceededError: Failed to set localStorage key "${key}" because browser storage is full. Please free up space.`;
    }
    console.error(specificMessage, error); // Log the more specific message and the original error object
    return false;
  }
};

// MangaRoom specific storage for its *active PDF's page index*
export const loadCurrentPdfPageIndexForDoc = (docId: string): number | undefined => {
  if (!docId) return undefined;
  const states = safeLocalStorageGet<{ [docId: string]: number }>(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, {});
  return states[docId];
};

export const saveCurrentPdfPageIndexForDoc = (docId: string, pageIndex: number): boolean => {
  if (!docId) return false;
  const states = safeLocalStorageGet<{ [docId: string]: number }>(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, {});
  states[docId] = pageIndex;
  return safeLocalStorageSet(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, states);
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
export const saveTTSSettings = (settings: TTSSettings): boolean => safeLocalStorageSet(TTS_SETTINGS_KEY, settings);

// Night Mode (shared)
export const loadNightMode = (): boolean => safeLocalStorageGet<boolean>(NIGHT_MODE_KEY, true);
export const saveNightMode = (isNightMode: boolean): boolean => safeLocalStorageSet(NIGHT_MODE_KEY, isNightMode);

// Library Page specific storage (StoredDocument - shared by MangaRoom for saving)
export const loadStoredDocuments = (): StoredDocument[] => {
    return safeLocalStorageGet<StoredDocument[]>(STORED_DOCUMENTS_KEY, []);
};

export const saveStoredDocuments = (documents: StoredDocument[]): boolean => {
    return safeLocalStorageSet(STORED_DOCUMENTS_KEY, documents);
};

export const addStoredDocument = (document: StoredDocument): boolean => {
    const documents = loadStoredDocuments();
    const existingDocIndex = documents.findIndex(d => d.id === document.id);
    if (existingDocIndex > -1) {
        console.warn(`Document with ID ${document.id} already exists in library. Updating existing.`);
        documents[existingDocIndex] = document;
    } else {
        documents.unshift(document); 
    }
    return saveStoredDocuments(documents);
};

export const deleteStoredDocument = (docId: string): boolean => {
    let documents = loadStoredDocuments();
    documents = documents.filter(doc => doc.id !== docId);
    return saveStoredDocuments(documents);
};

export const getStoredDocumentById = (docId: string): StoredDocument | undefined => {
    const documents = loadStoredDocuments();
    return documents.find(doc => doc.id === docId);
};

// Favorites Page specific storage (FavoriteItem - shared)
export const loadFavoriteItems = (): FavoriteItem[] => {
    return safeLocalStorageGet<FavoriteItem[]>(FAVORITE_ITEMS_KEY, []);
};

export const saveFavoriteItems = (items: FavoriteItem[]): boolean => {
    return safeLocalStorageSet(FAVORITE_ITEMS_KEY, items);
};

export const addFavoriteItem = (item: FavoriteItem): boolean => {
    const items = loadFavoriteItems();
    items.unshift(item); 
    return saveFavoriteItems(items);
};

export const deleteFavoriteItem = (itemId: string): boolean => {
    let items = loadFavoriteItems();
    items = items.filter(item => item.id !== itemId);
    return saveFavoriteItems(items);
};

// For MangaRoom to remember its last active document from the Library
export const saveLastActiveMangaRoomDocId = (docId: string | null): boolean => {
  return safeLocalStorageSet(LAST_ACTIVE_MANGAROOM_DOC_ID_KEY, docId);
};

export const loadLastActiveMangaRoomDocId = (): string | null => {
  return safeLocalStorageGet<string | null>(LAST_ACTIVE_MANGAROOM_DOC_ID_KEY, null);
};
