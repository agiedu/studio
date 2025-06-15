import type { MangaPage, TTSSettings } from '@/types';

const PAGES_KEY = 'mangaTalk_pages';
const CURRENT_PAGE_INDEX_KEY = 'mangaTalk_currentPageIndex';
const TTS_SETTINGS_KEY = 'mangaTalk_ttsSettings';
const NIGHT_MODE_KEY = 'mangaTalk_nightMode'; // Although theme is handled by AppHeader now

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

export const loadPages = (): MangaPage[] => safeLocalStorageGet<MangaPage[]>(PAGES_KEY, []);
export const savePages = (pages: MangaPage[]): void => safeLocalStorageSet(PAGES_KEY, pages);

export const loadCurrentPageIndex = (): number => safeLocalStorageGet<number>(CURRENT_PAGE_INDEX_KEY, 0);
export const saveCurrentPageIndex = (index: number): void => safeLocalStorageSet(CURRENT_PAGE_INDEX_KEY, index);

export const defaultTTSSettings: TTSSettings = {
  type: 'local',
  language: 'en-US',
  rate: 1,
  pitch: 1,
};
export const loadTTSSettings = (): TTSSettings => safeLocalStorageGet<TTSSettings>(TTS_SETTINGS_KEY, defaultTTSSettings);
export const saveTTSSettings = (settings: TTSSettings): void => safeLocalStorageSet(TTS_SETTINGS_KEY, settings);

// Night mode is now primarily handled by AppHeader's theme toggle and system preference
// These can be used if explicit night mode state outside of theme class is needed.
export const loadNightMode = (): boolean => safeLocalStorageGet<boolean>(NIGHT_MODE_KEY, true); // Default true for dark
export const saveNightMode = (isNightMode: boolean): void => safeLocalStorageSet(NIGHT_MODE_KEY, isNightMode);
