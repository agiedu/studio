
// src/lib/indexedDBService.ts
import type { StoredMangaDocument } from '@/types';

const DB_NAME = 'MangaTalkDB';
const DB_VERSION = 2; // Increment version if schema changes
const DOC_STORE_NAME = 'documents';
const LAST_ACTIVE_DOC_STORE_NAME = 'appState';
const LAST_ACTIVE_DOC_KEY = 'lastActiveDocIdRead2';

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error("IndexedDB can only be accessed in the browser."));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB error:', request.error);
        reject(new Error(`IndexedDB error: ${request.error?.message}`));
        dbPromise = null; // Reset promise on error
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(DOC_STORE_NAME)) {
          db.createObjectStore(DOC_STORE_NAME, { keyPath: 'id' });
        }
        if (event.oldVersion < 2 && !db.objectStoreNames.contains(LAST_ACTIVE_DOC_STORE_NAME)) {
          db.createObjectStore(LAST_ACTIVE_DOC_STORE_NAME, { keyPath: 'key' });
        }
      };
    });
  }
  return dbPromise;
}

export async function saveDocument(doc: StoredMangaDocument): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOC_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DOC_STORE_NAME);
    const request = store.put(doc);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Error saving document to IndexedDB:', request.error);
      reject(new Error(`Failed to save document: ${request.error?.message}`));
    };
  });
}

export async function getDocumentById(id: string): Promise<StoredMangaDocument | undefined> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOC_STORE_NAME, 'readonly');
    const store = transaction.objectStore(DOC_STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as StoredMangaDocument | undefined);
    request.onerror = () => {
      console.error('Error getting document from IndexedDB:', request.error);
      reject(new Error(`Failed to get document: ${request.error?.message}`));
    };
  });
}

export async function getAllDocuments(): Promise<StoredMangaDocument[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOC_STORE_NAME, 'readonly');
    const store = transaction.objectStore(DOC_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as StoredMangaDocument[]);
    request.onerror = () => {
      console.error('Error getting all documents from IndexedDB:', request.error);
      reject(new Error(`Failed to get all documents: ${request.error?.message}`));
    };
  });
}

export async function deleteDocumentById(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOC_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DOC_STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Error deleting document from IndexedDB:', request.error);
      reject(new Error(`Failed to delete document: ${request.error?.message}`));
    };
  });
}

export async function saveLastActiveDocId(docId: string | null): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LAST_ACTIVE_DOC_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(LAST_ACTIVE_DOC_STORE_NAME);
    const request = docId 
      ? store.put({ key: LAST_ACTIVE_DOC_KEY, value: docId })
      : store.delete(LAST_ACTIVE_DOC_KEY);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error('Error saving last active doc ID to IndexedDB:', request.error);
      reject(new Error(`Failed to save last active doc ID: ${request.error?.message}`));
    };
  });
}

export async function getLastActiveDocId(): Promise<string | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LAST_ACTIVE_DOC_STORE_NAME, 'readonly');
    const store = transaction.objectStore(LAST_ACTIVE_DOC_STORE_NAME);
    const request = store.get(LAST_ACTIVE_DOC_KEY);

    request.onsuccess = () => {
      resolve(request.result ? request.result.value : null);
    };
    request.onerror = () => {
      console.error('Error getting last active doc ID from IndexedDB:', request.error);
      reject(new Error(`Failed to get last active doc ID: ${request.error?.message}`));
    };
  });
}

// Helper to convert ArrayBuffer to Data URL
export function arrayBufferToDataURL(buffer: ArrayBuffer, type: string): string {
  const blob = new Blob([buffer], { type });
  return URL.createObjectURL(blob); // This creates a temporary URL
}

// For more permanent DataURLs if needed (e.g. for direct img src, though can be less performant for large files)
export function arrayBufferToBase64DataURL(buffer: ArrayBuffer, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], {type: type});
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = (error) => {
      reject(error);
    };
    reader.readAsDataURL(blob);
  });
}
