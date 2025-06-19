
import type { TTSSettings, StoredDocument, FavoriteItem, Read2StoredDocument } from '@/types';

const PDF_MANGA_DOCUMENT_PAGE_STATES_KEY = 'mangaTalk_pdfDocumentPageStates_v2';
const TTS_SETTINGS_KEY = 'mangaTalk_ttsSettings_v2';
const NIGHT_MODE_KEY = 'mangaTalk_nightMode_v2';

const STORED_DOCUMENTS_KEY = 'mangaTalk_storedDocuments_v1'; // For general library
const READ2_STORED_DOCUMENTS_KEY = 'mangaTalk_read2StoredDocuments_v1'; // For MangaRoom uploads
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
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || (error.message && error.message.toLowerCase().includes('quota')))) {
      specificMessage = `Error setting localStorage key "${key}": QUOTA_EXCEEDED_ERROR. Browser's Local Storage is FULL. The document was NOT saved. USER ACTION REQUIRED: Go to the app's Library page and DELETE some existing documents to free up space. This is a browser limitation, not an application bug.`;
    }
    console.error(specificMessage, error);
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

// General Library Page specific storage (StoredDocument)
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
        documents[existingDocIndex] = document;
    } else {
        documents.unshift(document); // Add new documents to the beginning
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

// Read2 (MangaRoom) specific storage
export const loadRead2StoredDocuments = (): Read2StoredDocument[] => {
    return safeLocalStorageGet<Read2StoredDocument[]>(READ2_STORED_DOCUMENTS_KEY, []);
};

export const saveRead2StoredDocuments = (documents: Read2StoredDocument[]): boolean => {
    return safeLocalStorageSet(READ2_STORED_DOCUMENTS_KEY, documents);
};

export const addRead2StoredDocument = (document: Read2StoredDocument): boolean => {
    const documents = loadRead2StoredDocuments();
    const existingDocIndex = documents.findIndex(d => d.id === document.id);
    if (existingDocIndex > -1) {
        documents[existingDocIndex] = document;
    } else {
        documents.unshift(document); // Add new documents to the beginning
    }
    return saveRead2StoredDocuments(documents);
};

export const deleteRead2StoredDocument = (docId: string): boolean => {
    let documents = loadRead2StoredDocuments();
    documents = documents.filter(doc => doc.id !== docId);
    return saveRead2StoredDocuments(documents);
};

export const getRead2StoredDocumentById = (docId: string): Read2StoredDocument | undefined => {
    const documents = loadRead2StoredDocuments();
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
    items.unshift(item); // Add new favorites to the beginning
    return saveFavoriteItems(items);
};

export const deleteFavoriteItem = (itemId: string): boolean => {
    let items = loadFavoriteItems();
    items = items.filter(item => item.id !== itemId);
    return saveFavoriteItems(items);
};

// For MangaRoom to remember its last active document from ITS OWN Read2 list
export const saveLastActiveMangaRoomDocId = (docId: string | null): boolean => {
  return safeLocalStorageSet(LAST_ACTIVE_MANGAROOM_DOC_ID_KEY, docId);
};

export const loadLastActiveMangaRoomDocId = (): string | null => {
  return safeLocalStorageGet<string | null>(LAST_ACTIVE_MANGAROOM_DOC_ID_KEY, null);
};
