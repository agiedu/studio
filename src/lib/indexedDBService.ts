
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
        console.error('[IndexedDBService] DB open error:', request.error);
        reject(new Error(`IndexedDB error: ${request.error?.message}`));
        dbPromise = null; // Reset promise on error
      };

      request.onsuccess = () => {
        console.log('[IndexedDBService] DB opened successfully.');
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        console.log('[IndexedDBService] DB upgrade needed.');
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(DOC_STORE_NAME)) {
          console.log(`[IndexedDBService] Creating ${DOC_STORE_NAME} store.`);
          db.createObjectStore(DOC_STORE_NAME, { keyPath: 'id' });
        }
        if (event.oldVersion < 2 && !db.objectStoreNames.contains(LAST_ACTIVE_DOC_STORE_NAME)) {
          console.log(`[IndexedDBService] Creating ${LAST_ACTIVE_DOC_STORE_NAME} store.`);
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

    request.onsuccess = () => {
        console.log(`[IndexedDBService] saveDocument: IDBRequest successful for saving docId: ${doc.id}.`);
    };
    request.onerror = (event) => {
        console.error(`[IndexedDBService] saveDocument: IDBRequest error saving docId ${doc.id}:`, (event.target as IDBRequest).error);
    };

    transaction.oncomplete = () => {
      console.log(`[IndexedDBService] saveDocument: Transaction completed for saving docId: ${doc.id}`);
      resolve();
    };
    transaction.onerror = () => {
      console.error(`[IndexedDBService] saveDocument: Transaction error saving docId ${doc.id}:`, transaction.error);
      reject(new Error(`Failed to save document (transaction error): ${transaction.error?.message}`));
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
      console.error(`[IndexedDBService] getDocumentById: Error getting document by ID ${id}:`, request.error);
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
      console.error('[IndexedDBService] getAllDocuments: Error getting all documents:', request.error);
      reject(new Error(`Failed to get all documents: ${request.error?.message}`));
    };
  });
}

export async function deleteDocumentById(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    if (!id || typeof id !== 'string') {
      const errorMsg = `[IndexedDBService] deleteDocumentById: Invalid ID provided: ${id}`;
      console.error(errorMsg);
      return reject(new Error('Invalid ID for deletion.'));
    }
    const transaction = db.transaction(DOC_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DOC_STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => {
        console.log(`[IndexedDBService] deleteDocumentById: IDBRequest successful for deleting docId: ${id}.`);
    };
    request.onerror = (event) => {
        console.error(`[IndexedDBService] deleteDocumentById: IDBRequest FAILED for deleting docId ${id}:`, (event.target as IDBRequest).error);
    };

    transaction.oncomplete = () => {
      console.log(`[IndexedDBService] deleteDocumentById: Transaction COMPLETED for deleting docId: ${id}`);
      resolve();
    };
    transaction.onerror = () => {
      console.error(`[IndexedDBService] deleteDocumentById: Transaction FAILED for deleting docId ${id}:`, transaction.error);
      reject(new Error(`Failed to delete document (transaction error): ${transaction.error?.message}`));
    };
  });
}

export async function saveLastActiveDocId(docId: string | null): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LAST_ACTIVE_DOC_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(LAST_ACTIVE_DOC_STORE_NAME);
    let request: IDBRequest;

    if (docId === null) {
      console.log(`[IndexedDBService] saveLastActiveDocId: Attempting to delete last active doc ID (key: ${LAST_ACTIVE_DOC_KEY})`);
      request = store.delete(LAST_ACTIVE_DOC_KEY);
    } else if (typeof docId === 'string') {
      console.log(`[IndexedDBService] saveLastActiveDocId: Attempting to save last active doc ID (key: ${LAST_ACTIVE_DOC_KEY}, value: ${docId})`);
      request = store.put({ key: LAST_ACTIVE_DOC_KEY, value: docId });
    } else {
      const errorMsg = `[IndexedDBService] saveLastActiveDocId: Invalid docId provided: ${docId}`;
      console.error(errorMsg);
      return reject(new Error('Invalid docId for saveLastActiveDocId.'));
    }
    
    request.onsuccess = () => {
        console.log(`[IndexedDBService] saveLastActiveDocId: IDBRequest successful for key: ${LAST_ACTIVE_DOC_KEY}.`);
    };
    request.onerror = (event) => {
        console.error(`[IndexedDBService] saveLastActiveDocId: IDBRequest FAILED for key ${LAST_ACTIVE_DOC_KEY}:`, (event.target as IDBRequest).error);
    };

    transaction.oncomplete = () => {
      console.log(`[IndexedDBService] saveLastActiveDocId: Transaction COMPLETED for key: ${LAST_ACTIVE_DOC_KEY}, new value was: ${docId === null ? '<deleted>' : docId})`);
      resolve();
    };
    transaction.onerror = () => {
      console.error(`[IndexedDBService] saveLastActiveDocId: Transaction FAILED for key ${LAST_ACTIVE_DOC_KEY}:`, transaction.error);
      reject(new Error(`Transaction error for last active doc ID: ${transaction.error?.message}`));
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
      if (request.result && request.result.value) {
        console.log(`[IndexedDBService] getLastActiveDocId: Found last active doc ID: ${request.result.value}`);
        resolve(request.result.value as string);
      } else {
        console.log(`[IndexedDBService] getLastActiveDocId: No last active doc ID found.`);
        resolve(null);
      }
    };
    request.onerror = () => {
      console.error(`[IndexedDBService] getLastActiveDocId: Error getting last active doc ID for key ${LAST_ACTIVE_DOC_KEY}:`, request.error);
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
