
// src/lib/indexedDBService.ts
import type { StoredMangaDocument } from '@/types';

const DB_NAME = 'MangaTalkDB';
const DB_VERSION = 2;
const DOC_STORE_NAME = 'documents';
const LAST_ACTIVE_DOC_STORE_NAME = 'appState';
const LAST_ACTIVE_DOC_KEY = 'lastActiveDocIdRead2';

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    console.error("[IndexedDBService] getDB called in a non-browser environment.");
    return Promise.reject(new Error("IndexedDB can only be accessed in the browser."));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      console.log(`[IndexedDBService] Opening database ${DB_NAME} version ${DB_VERSION}...`);
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[IndexedDBService] DB open error:', request.error);
        reject(new Error(`IndexedDB error: ${request.error?.message}`));
        dbPromise = null; 
      };

      request.onsuccess = () => {
        console.log('[IndexedDBService] DB opened successfully.');
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        console.log('[IndexedDBService] DB upgrade needed.');
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(DOC_STORE_NAME)) {
          console.log(`[IndexedDBService] Creating ${DOC_STORE_NAME} store with keyPath 'id'.`);
          db.createObjectStore(DOC_STORE_NAME, { keyPath: 'id' });
        }
        if (event.oldVersion < 2 && !db.objectStoreNames.contains(LAST_ACTIVE_DOC_STORE_NAME)) {
          console.log(`[IndexedDBService] Creating ${LAST_ACTIVE_DOC_STORE_NAME} store with keyPath 'key'.`);
          db.createObjectStore(LAST_ACTIVE_DOC_STORE_NAME, { keyPath: 'key' });
        }
         console.log('[IndexedDBService] DB upgrade complete.');
      };
    });
  }
  return dbPromise;
}

export async function saveDocument(doc: StoredMangaDocument): Promise<void> {
  console.log(`[IndexedDBService] saveDocument: Attempting to save docId: ${doc.id}, title: "${doc.title}"`);
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOC_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DOC_STORE_NAME);
    
    console.log(`[IndexedDBService] saveDocument: Transaction started for docId: ${doc.id}. Attempting store.put().`);
    const request = store.put(doc);

    request.onsuccess = () => {
        console.log(`[IndexedDBService] saveDocument: IDBRequest successful for saving docId: ${doc.id}. Waiting for transaction to complete.`);
    };
    request.onerror = (event) => {
        const error = (event.target as IDBRequest).error;
        console.error(`[IndexedDBService] saveDocument: IDBRequest FAILED for saving docId ${doc.id}:`, error);
        // Rely on transaction.onerror to reject the promise
    };

    transaction.oncomplete = () => {
      console.log(`[IndexedDBService] saveDocument: Transaction COMPLETED for saving docId: ${doc.id}`);
      resolve();
    };
    transaction.onerror = () => {
      console.error(`[IndexedDBService] saveDocument: Transaction FAILED for saving docId ${doc.id}:`, transaction.error);
      reject(new Error(`Failed to save document "${doc.title}" (transaction error): ${transaction.error?.message}`));
    };
  });
}

export async function getDocumentById(id: string): Promise<StoredMangaDocument | undefined> {
  console.log(`[IndexedDBService] getDocumentById: Attempting to get docId: ${id}`);
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOC_STORE_NAME, 'readonly');
    const store = transaction.objectStore(DOC_STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
        const result = request.result as StoredMangaDocument | undefined;
        if (result) {
            console.log(`[IndexedDBService] getDocumentById: Successfully retrieved docId: ${id}, title: "${result.title}"`);
        } else {
            console.log(`[IndexedDBService] getDocumentById: No document found for docId: ${id}`);
        }
        resolve(result);
    };
    request.onerror = () => {
      console.error(`[IndexedDBService] getDocumentById: Error getting document by ID ${id}:`, request.error);
      reject(new Error(`Failed to get document ID "${id}": ${request.error?.message}`));
    };
  });
}

export async function getAllDocuments(): Promise<StoredMangaDocument[]> {
  console.log(`[IndexedDBService] getAllDocuments: Attempting to get all documents.`);
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOC_STORE_NAME, 'readonly');
    const store = transaction.objectStore(DOC_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
        const results = request.result as StoredMangaDocument[];
        console.log(`[IndexedDBService] getAllDocuments: Successfully retrieved ${results.length} documents.`);
        resolve(results);
    };
    request.onerror = () => {
      console.error('[IndexedDBService] getAllDocuments: Error getting all documents:', request.error);
      reject(new Error(`Failed to get all documents: ${request.error?.message}`));
    };
  });
}

export async function deleteDocumentById(id: string): Promise<void> {
  if (!id || typeof id !== 'string' || id.trim() === "") {
    const errorMsg = `[IndexedDBService] deleteDocumentById: Invalid ID provided for deletion: "${id}" (type: ${typeof id})`;
    console.error(errorMsg);
    return Promise.reject(new Error('Invalid ID for deletion.'));
  }
  console.log(`[IndexedDBService] deleteDocumentById: Starting transaction to delete docId: "${id}"`);
  const db = await getDB();
  return new Promise((resolve, reject) => { // This promise is key
    const transaction = db.transaction(DOC_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DOC_STORE_NAME);
    
    console.log(`[IndexedDBService] deleteDocumentById: Transaction created for docId: "${id}". Attempting store.delete().`);
    const request = store.delete(id); // This is an IDBRequest

    request.onsuccess = () => { // Request queued successfully
        console.log(`[IndexedDBService] deleteDocumentById: IDBRequest for delete() was successful for docId: "${id}". Waiting for transaction to complete.`);
    };
    request.onerror = (event) => { // Request failed to queue
        const error = (event.target as IDBRequest).error;
        console.error(`[IndexedDBService] deleteDocumentById: IDBRequest for delete() FAILED for docId "${id}":`, error);
        // Don't reject here; let transaction.onerror handle it, which correctly rejects the main promise.
    };

    transaction.oncomplete = () => { // Transaction completed successfully
      console.log(`[IndexedDBService] deleteDocumentById: Transaction COMPLETED successfully for deleting docId: "${id}"`);
      resolve(); // Resolve the main promise HERE
    };
    transaction.onerror = () => { // Transaction failed
      console.error(`[IndexedDBService] deleteDocumentById: Transaction FAILED for deleting docId "${id}":`, transaction.error);
      reject(new Error(`Failed to delete document (ID: "${id}", transaction error): ${transaction.error?.message}`)); // Reject the main promise HERE
    };
  });
}

export async function saveLastActiveDocId(docId: string | null): Promise<void> {
  const operationType = docId === null ? 'delete' : 'put';
  console.log(`[IndexedDBService] saveLastActiveDocId: Attempting to ${operationType} last active doc ID. Key: ${LAST_ACTIVE_DOC_KEY}, New Value: ${docId}`);
  const db = await getDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(LAST_ACTIVE_DOC_STORE_NAME)) {
        const errorMsg = `[IndexedDBService] saveLastActiveDocId: Store ${LAST_ACTIVE_DOC_STORE_NAME} does not exist. Cannot ${operationType} last active doc ID.`;
        console.error(errorMsg);
        // Non-critical, resolve to allow app to continue, but log error.
        return resolve(); 
    }

    const transaction = db.transaction(LAST_ACTIVE_DOC_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(LAST_ACTIVE_DOC_STORE_NAME);
    let request: IDBRequest;

    console.log(`[IndexedDBService] saveLastActiveDocId: Transaction created for key: ${LAST_ACTIVE_DOC_KEY}. Attempting store.${operationType}().`);
    if (docId === null) {
      request = store.delete(LAST_ACTIVE_DOC_KEY);
    } else if (typeof docId === 'string') {
      request = store.put({ key: LAST_ACTIVE_DOC_KEY, value: docId });
    } else {
      const errorMsgInvalid = `[IndexedDBService] saveLastActiveDocId: Invalid docId provided: ${docId}`;
      console.error(errorMsgInvalid);
      return reject(new Error('Invalid docId for saveLastActiveDocId.'));
    }
    
    request.onsuccess = () => {
        console.log(`[IndexedDBService] saveLastActiveDocId: IDBRequest for ${operationType}() was successful for key: ${LAST_ACTIVE_DOC_KEY}. Waiting for transaction to complete.`);
    };
    request.onerror = (event) => {
        const error = (event.target as IDBRequest).error;
        console.error(`[IndexedDBService] saveLastActiveDocId: IDBRequest for ${operationType}() FAILED for key ${LAST_ACTIVE_DOC_KEY}:`, error);
    };

    transaction.oncomplete = () => {
      console.log(`[IndexedDBService] saveLastActiveDocId: Transaction COMPLETED for key: ${LAST_ACTIVE_DOC_KEY}, operation ${operationType}, new value was: ${docId === null ? '<deleted>' : docId}`);
      resolve();
    };
    transaction.onerror = () => {
      console.error(`[IndexedDBService] saveLastActiveDocId: Transaction FAILED for key ${LAST_ACTIVE_DOC_KEY}, operation ${operationType}:`, transaction.error);
      reject(new Error(`Transaction error for last active doc ID (operation ${operationType}): ${transaction.error?.message}`));
    };
  });
}

export async function getLastActiveDocId(): Promise<string | null> {
  console.log(`[IndexedDBService] getLastActiveDocId: Attempting to get last active doc ID for key: ${LAST_ACTIVE_DOC_KEY}`);
  const db = await getDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(LAST_ACTIVE_DOC_STORE_NAME)) {
      console.warn(`[IndexedDBService] getLastActiveDocId: Store ${LAST_ACTIVE_DOC_STORE_NAME} does not exist. Returning null as no last active ID can be stored.`);
      return resolve(null); 
    }
    const transaction = db.transaction(LAST_ACTIVE_DOC_STORE_NAME, 'readonly');
    const store = transaction.objectStore(LAST_ACTIVE_DOC_STORE_NAME);
    const request = store.get(LAST_ACTIVE_DOC_KEY);

    request.onsuccess = () => {
      if (request.result && request.result.value && typeof request.result.value === 'string') {
        console.log(`[IndexedDBService] getLastActiveDocId: Found last active doc ID: "${request.result.value}"`);
        resolve(request.result.value as string);
      } else {
        console.log(`[IndexedDBService] getLastActiveDocId: No last active doc ID found or value is invalid (key: ${LAST_ACTIVE_DOC_KEY}). Result:`, request.result);
        resolve(null);
      }
    };
    request.onerror = () => {
      console.error(`[IndexedDBService] getLastActiveDocId: Error getting last active doc ID for key ${LAST_ACTIVE_DOC_KEY}:`, request.error);
      reject(new Error(`Failed to get last active doc ID: ${request.error?.message}`));
    };
  });
}

export function arrayBufferToTempURL(buffer: ArrayBuffer, type: string): string {
  const blob = new Blob([buffer], { type });
  const url = URL.createObjectURL(blob);
  console.log(`[IndexedDBService] Created temporary URL for blob of type ${type}: ${url}`);
  return url; 
}

export function arrayBufferToBase64DataURL(buffer: ArrayBuffer, type: string): Promise<string> {
  console.log(`[IndexedDBService] arrayBufferToBase64DataURL: Converting ArrayBuffer (length ${buffer.byteLength}) of type ${type} to Base64 Data URL.`);
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], {type: type});
    const reader = new FileReader();
    reader.onload = () => {
      console.log(`[IndexedDBService] arrayBufferToBase64DataURL: Conversion successful.`);
      resolve(reader.result as string);
    };
    reader.onerror = (error) => {
      console.error(`[IndexedDBService] arrayBufferToBase64DataURL: Conversion failed.`, error);
      reject(error);
    };
    reader.readAsDataURL(blob);
  });
}
    

    