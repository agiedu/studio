
import type { TTSSettings, FavoriteItem, MangaDocumentDisplayInfo } from '@/types';
// PDF_MANGA_DOCUMENT_PAGE_STATES_KEY will be managed differently or per document in IndexedDB if needed.
// For now, we simplify and assume MangaRoom handles its current page index in component state.

const TTS_SETTINGS_KEY = 'mangaTalk_ttsSettings_v2';
const FAVORITE_ITEMS_KEY = 'mangaTalk_favoriteItems_v1';
const SCRATCHPAD_TEXT_KEY = 'mangaTalk_scratchpadText_v1';
const DOC_METADATA_CACHE_KEY = 'mangaTalk_docMetadataCache_v1';
const TTS_TEXT_SIZE_KEY = 'mangaTalk_ttsTextSize_v1';


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
      specificMessage = `Error setting localStorage key "${key}": QUOTA_EXCEEDED_ERROR. Browser's Local Storage is FULL.`;
    }
    console.error(specificMessage, error);
    return false;
  }
};

// --- PDF Page Index ---
const PDF_MANGA_DOCUMENT_PAGE_STATES_KEY = 'mangaTalk_pdfDocumentPageStates_v3';
export const loadCurrentPdfPageIndexForDoc = (docId: string): number | undefined => {
  if (!docId || typeof window === 'undefined') return undefined;
  const states = safeLocalStorageGet<{ [docId: string]: number }>(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, {});
  return states[docId];
};
export const saveCurrentPdfPageIndexForDoc = (docId: string, pageIndex: number): boolean => {
  if (!docId || typeof window === 'undefined') return false;
  const states = safeLocalStorageGet<{ [docId: string]: number }>(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, {});
  states[docId] = pageIndex;
  return safeLocalStorageSet(PDF_MANGA_DOCUMENT_PAGE_STATES_KEY, states);
};

// --- EPUB CFI (Location) ---
const EPUB_MANGA_DOCUMENT_CFI_KEY = 'mangaTalk_epubDocumentCfi_v1';
export const loadCurrentEpubCfiForDoc = (docId: string): string | undefined => {
    if (!docId || typeof window === 'undefined') return undefined;
    const states = safeLocalStorageGet<{ [docId: string]: string }>(EPUB_MANGA_DOCUMENT_CFI_KEY, {});
    return states[docId];
};
export const saveCurrentEpubCfiForDoc = (docId: string, cfi: string): boolean => {
    if (!docId || typeof window === 'undefined') return false;
    const states = safeLocalStorageGet<{ [docId: string]: string }>(EPUB_MANGA_DOCUMENT_CFI_KEY, {});
    states[docId] = cfi;
    return safeLocalStorageSet(EPUB_MANGA_DOCUMENT_CFI_KEY, states);
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

// Scratchpad Text
export const loadScratchpadText = (): string => {
  return safeLocalStorageGet<string>(SCRATCHPAD_TEXT_KEY, '');
};

export const saveScratchpadText = (text: string): boolean => {
  return safeLocalStorageSet(SCRATCHPAD_TEXT_KEY, text);
};

// Document Metadata Cache
export const loadDocumentMetadata = (): MangaDocumentDisplayInfo[] => {
  return safeLocalStorageGet<MangaDocumentDisplayInfo[]>(DOC_METADATA_CACHE_KEY, []);
};

export const saveDocumentMetadata = (metadata: MangaDocumentDisplayInfo[]): boolean => {
  return safeLocalStorageSet(DOC_METADATA_CACHE_KEY, metadata);
};

// TTS Text Size
export const defaultTtsTextSize = 14;
export const loadTtsTextSize = (): number => {
  return safeLocalStorageGet<number>(TTS_TEXT_SIZE_KEY, defaultTtsTextSize);
};
export const saveTtsTextSize = (size: number): boolean => {
  return safeLocalStorageSet(TTS_TEXT_SIZE_KEY, size);
};

    
