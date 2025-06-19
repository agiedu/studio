
import type { TTSSettings, FavoriteItem } from '@/types';

const PDF_MANGA_DOCUMENT_PAGE_STATES_KEY = 'mangaTalk_pdfDocumentPageStates_v2';
const TTS_SETTINGS_KEY = 'mangaTalk_ttsSettings_v2';
const NIGHT_MODE_KEY = 'mangaTalk_nightMode_v2';
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

const safeLocalStorageSet = (key: string, value: any): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error: any) {
    let specificMessage = `Error setting localStorage key "${key}"`;
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || (error.message && error.message.toLowerCase().includes('quota')))) {
      specificMessage = `Error setting localStorage key "${key}": QUOTA_EXCEEDED_ERROR. Browser's Local Storage is FULL. USER ACTION REQUIRED: Consider clearing site data or managing other stored items if this persists for non-document data.`;
    }
    console.error(specificMessage, error);
    return false;
  }
};

// MangaRoom specific storage for its *active PDF's page index* (session-like)
export const loadCurrentPdfPageIndexForDoc = (docId: string): number | undefined => {
  if (!docId || typeof window === 'undefined') return undefined; // Ensure this is only for client-side temporary state
  const states = safeLocalStorageGet<{ [docId: string]: number }>(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, {});
  return states[docId];
};

export const saveCurrentPdfPageIndexForDoc = (docId: string, pageIndex: number): boolean => {
  if (!docId || typeof window === 'undefined') return false; // Ensure this is only for client-side temporary state
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
  return { ...defaultTTSSettings, ...settings };
};
export const saveTTSSettings = (settings: TTSSettings): boolean => safeLocalStorageSet(TTS_SETTINGS_KEY, settings);

// Night Mode (shared)
export const loadNightMode = (): boolean => safeLocalStorageGet<boolean>(NIGHT_MODE_KEY, true);
export const saveNightMode = (isNightMode: boolean): boolean => safeLocalStorageSet(NIGHT_MODE_KEY, isNightMode);

// Favorites Page specific storage (FavoriteItem - shared)
export const loadFavoriteItems = (): FavoriteItem[] => {
    return safeLocalStorageGet<FavoriteItem[]>(FAVORITE_ITEMS_KEY, []);
};

export const saveFavoriteItems = (items: FavoriteItem[]): boolean => {
    return safeLocalStorageSet(FAVORITE_ITEMS_KEY, items);
};

export const addFavoriteItem = (item: FavoriteItem): boolean => {
    const items = loadFavoriteItems();
    items.unshift(item); // Add new to the beginning
    return saveFavoriteItems(items);
};

export const deleteFavoriteItem = (itemId: string): boolean => {
    let items = loadFavoriteItems();
    items = items.filter(item => item.id !== itemId);
    return saveFavoriteItems(items);
};
