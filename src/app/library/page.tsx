
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { UploadCloud, AlertTriangle, Info, Trash2, BookOpen, FileText, Image as ImageIcon, RefreshCw, Loader2, Save, FileType2, Book } from 'lucide-react';
import * as IndexedDBService from '@/lib/indexedDBService';
import type { StoredMangaDocument } from '@/types';
import { getDocument, GlobalWorkerOptions, version as pdfjsVersion } from 'pdfjs-dist';


function arrayBufferToBlob(buffer: ArrayBuffer, type: string): Blob {
  return new Blob([buffer], { type });
}

export default function LibraryPage() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingToDevice, setIsSavingToDevice] = useState<string | null>(null);
  const [storedDocuments, setStoredDocuments] = useState<StoredMangaDocument[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  console.log(`[LibraryPage] Component rendering. Initial states: isLoading: ${isLoading}, isUploading: ${isUploading}, isSavingToDevice: ${isSavingToDevice}`);

  const fetchDocuments = useCallback(async (operationLabel: string = "Fetching documents") => {
    console.log(`[LibraryPage] ${operationLabel}...`);
    setIsLoading(true);
    try {
      const docs = await IndexedDBService.getAllDocuments();
      console.log(`[LibraryPage] Fetched ${docs.length} documents from IndexedDB for "${operationLabel}".`);
      setStoredDocuments(docs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error Loading Documents", description: `Could not load documents. ${error.message}` });
      console.error(`[LibraryPage] Error during "${operationLabel}" from IndexedDB:`, error);
    } finally {
      setIsLoading(false);
      console.log(`[LibraryPage] Finished ${operationLabel} attempt. isLoading is now: false`);
    }
  }, [toast]);

  useEffect(() => {
    fetchDocuments("Initial document fetch");
     if (typeof window !== 'undefined' && !GlobalWorkerOptions.workerSrc) {
        GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
    }
  }, [fetchDocuments]);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    console.log(`[LibraryPage] Starting file upload process for: "${file.name}", type: "${file.type}"`);
    setIsUploading(true);
    const docId = `doc_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    let newDocument: StoredMangaDocument | null = null;

    try {
      const fileBuffer = await file.arrayBuffer();
      console.log(`[LibraryPage] File "${file.name}" read into ArrayBuffer (size: ${fileBuffer.byteLength} bytes).`);
      const commonDocProps = {
        id: docId,
        title: file.name,
        fileData: fileBuffer,
        originalType: file.type,
        createdAt: Date.now(),
      };

      if (file.type.startsWith('image/')) {
        newDocument = { ...commonDocProps, type: 'image', extractedText: undefined };
      } else if (file.type === 'application/pdf') {
         try {
            const pdfLoadingTask = getDocument({ data: fileBuffer.slice(0) }); // Use slice(0) to create a copy for pdf.js
            const pdfInstance = await pdfLoadingTask.promise;
            console.log(`[LibraryPage] PDF "${file.name}" processed by pdf.js, numPages: ${pdfInstance.numPages}.`);
            newDocument = { ...commonDocProps, type: 'pdf', numPages: pdfInstance.numPages, ocrTextPerPage: {} };
          } catch (pdfError: any) {
            console.warn(`[LibraryPage] Could not get PDF page count for ${file.name}:`, pdfError);
            toast({ variant: "default", title: "PDF Info", description: `Uploaded PDF "${file.name}". Page count issue: ${pdfError.message}. Document still saved.` });
            newDocument = { ...commonDocProps, type: 'pdf', numPages: undefined, ocrTextPerPage: {} }; // Save even if page count fails
          }
      } else if (file.type === 'application/epub+zip' || file.name.toLowerCase().endsWith('.epub')) {
        newDocument = { ...commonDocProps, type: 'epub', originalType: 'application/epub+zip' };
      } else if (file.type === 'application/x-mobipocket-ebook' || file.name.toLowerCase().endsWith('.mobi')) {
        newDocument = { ...commonDocProps, type: 'mobi', originalType: 'application/x-mobipocket-ebook' };
      } else if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
        newDocument = { ...commonDocProps, type: 'txt', originalType: 'text/plain' };
      } else {
        toast({ variant: "destructive", title: "Unsupported File Type", description: `Type "${file.type || 'unknown'}" (${file.name}) not supported. Please upload Image, PDF, EPUB, MOBI, or TXT.` });
        console.warn(`[LibraryPage] Unsupported file type: "${file.type}" for file "${file.name}"`);
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      if (newDocument) {
        console.log(`[LibraryPage] Preparing to save new document to IndexedDB: ID ${newDocument.id}, Title "${newDocument.title}"`);
        await IndexedDBService.saveDocument(newDocument);
        toast({ title: "Document Saved in Browser", description: `"${newDocument.title}" saved.` });
        console.log(`[LibraryPage] Document "${newDocument.title}" saved. Fetching updated documents list.`);
        await fetchDocuments("Post-upload document fetch");
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Upload & Save Error", description: `Failed to process/save "${file.name}". ${error.message}` });
      console.error(`[LibraryPage] Error handling file upload for "${file.name}":`, error);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = ""; // Reset file input
      }
      console.log(`[LibraryPage] File upload process finished for: "${file.name}". isUploading is now: false`);
    }
  }, [fetchDocuments, toast]);


  const handleDeleteDocument = useCallback(async (docId: string, docTitle?: string) => {
    console.log(`[LibraryPage] handleDeleteDocument CALLED. DocId: "${docId}", Title: "${docTitle}"`);

    if (!docId) {
      console.error("[LibraryPage] handleDeleteDocument: Invalid docId (null or empty). Aborting deletion.");
      toast({ variant: "destructive", title: "Delete Error", description: "Cannot delete: Document ID is missing." });
      return;
    }

    const titleForConfirm = docTitle || `document with ID ${docId}`;
    if (!window.confirm(`Are you sure you want to delete "${titleForConfirm}" from your browser storage? This action cannot be undone.`)) {
      console.log(`[LibraryPage] handleDeleteDocument: User CANCELLED deletion for docId: "${docId}"`);
      return;
    }
    
    console.log(`[LibraryPage] handleDeleteDocument: User CONFIRMED deletion for docId: "${docId}".`);

    try {
      console.log(`[LibraryPage] handleDeleteDocument: Attempting IndexedDBService.deleteDocumentById("${docId}")...`);
      await IndexedDBService.deleteDocumentById(docId);
      console.log(`[LibraryPage] handleDeleteDocument: SUCCESS - IndexedDBService.deleteDocumentById("${docId}") resolved.`);

      setStoredDocuments(prevDocs => {
        const updatedDocs = prevDocs.filter(d => d.id !== docId);
        console.log(`[LibraryPage] handleDeleteDocument: React state 'storedDocuments' updated. Prev count: ${prevDocs.length}, New count: ${updatedDocs.length}. Removed ID: ${docId}`);
        return updatedDocs;
      });
      
      const lastActiveId = await IndexedDBService.getLastActiveDocId();
      console.log(`[LibraryPage] handleDeleteDocument: Last active docId from DB was: "${lastActiveId}" (checking against deleted docId: "${docId}")`);
      if (lastActiveId === docId) {
        console.log(`[LibraryPage] handleDeleteDocument: Deleted document "${docId}" was the last active. Attempting to clear last active docId.`);
        await IndexedDBService.saveLastActiveDocId(null);
        console.log(`[LibraryPage] handleDeleteDocument: Last active docId cleared or attempt finished for "${docId}".`);
      }
      
      toast({ title: "Document Deleted", description: `"${titleForConfirm}" removed from browser storage.` });
      console.log(`[LibraryPage] handleDeleteDocument: Successfully processed deletion for docId: "${docId}".`);

      // Optional: Re-fetch for absolute consistency, though the immediate state update should handle the UI.
      // console.log(`[LibraryPage] handleDeleteDocument: Calling fetchDocuments for post-delete re-sync for docId "${docId}".`);
      // await fetchDocuments(`Post-delete re-sync for docId "${docId}"`);
      // console.log(`[LibraryPage] handleDeleteDocument: fetchDocuments completed after deleting "${docId}".`);

    } catch (error:any) {
      console.error(`[LibraryPage] handleDeleteDocument: ERROR during deletion process for document "${docId}":`, error);
      toast({ variant: "destructive", title: "Delete Failed", description: `Failed to delete "${titleForConfirm}". ${error.message || 'Unknown error'}. Please refresh.` });
      // If deletion fails, it's good practice to re-fetch to ensure UI matches the actual DB state.
      console.log(`[LibraryPage] handleDeleteDocument: Calling fetchDocuments() after failed delete of "${docId}" to attempt error recovery UI sync.`);
      await fetchDocuments(`Error recovery fetch after failed delete of "${docId}"`);
    }
  }, [fetchDocuments, toast]);


  const handleSaveToDevice = useCallback(async (doc: StoredMangaDocument) => {
    if (!doc.fileData || !doc.title || !doc.originalType) {
        toast({variant: "destructive", title: "Save Error", description: "Document data is incomplete for saving."});
        console.error("[LibraryPage] handleSaveToDevice: Incomplete document data.", doc);
        return;
    }
    console.log(`[LibraryPage] handleSaveToDevice: Attempting to save docId: "${doc.id}", Title: "${doc.title}" to device.`);
    setIsSavingToDevice(doc.id);

    try {
      const blob = arrayBufferToBlob(doc.fileData, doc.originalType);
      console.log(`[LibraryPage] Created blob for "${doc.title}" (size: ${blob.size}, type: ${blob.type}).`);
      
      if (typeof window.showSaveFilePicker === 'function') {
        console.log(`[LibraryPage] Using File System Access API (showSaveFilePicker) for "${doc.title}".`);
        const suggestedName = doc.title;
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: suggestedName,
          types: [ { description: 'Document File', accept: { [doc.originalType]: [`.${doc.title.split('.').pop() || 'bin'}`] } } ],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        toast({ title: "Saved to Device", description: `"${doc.title}" successfully saved.` });
        console.log(`[LibraryPage] File "${doc.title}" saved successfully using File System Access API.`);
      } else {
        console.log(`[LibraryPage] Using download link fallback for "${doc.title}".`);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.title;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast({ title: "Download Started", description: `"${doc.title}" is downloading.` });
        console.log(`[LibraryPage] Download initiated for "${doc.title}".`);
      }
    } catch (error: any) {
        if (error.name === 'AbortError') {
          toast({ variant: "default", title: "Save Cancelled", description: "File saving was cancelled." });
          console.log(`[LibraryPage] File saving cancelled by user for "${doc.title}".`);
        } else {
          toast({ variant: "destructive", title: "Save to Device Failed", description: `Could not save "${doc.title}". ${error.message}` });
          console.error(`[LibraryPage] Error saving file "${doc.title}" to device:`, error);
        }
    } finally {
        setIsSavingToDevice(null);
        console.log(`[LibraryPage] handleSaveToDevice finished for docId: "${doc.id}". isSavingToDevice is now: null`);
    }
  }, [toast]);
  
  const getDocumentIcon = (docType: StoredMangaDocument['type']) => {
    switch (docType) {
      case 'image': return <ImageIcon className="h-8 w-8 text-primary flex-shrink-0" />;
      case 'pdf': return <FileType2 className="h-8 w-8 text-primary flex-shrink-0" />; 
      case 'epub': return <BookOpen className="h-8 w-8 text-primary flex-shrink-0" />;
      case 'mobi': return <Book className="h-8 w-8 text-primary flex-shrink-0" />; 
      case 'txt': return <FileText className="h-8 w-8 text-primary flex-shrink-0" />;
      default: return <FileText className="h-8 w-8 text-primary flex-shrink-0" />; 
    }
  };
  
  console.log(`[LibraryPage] RENDERING. isLoading: ${isLoading}, isUploading: ${isUploading}, isSavingToDevice: ${isSavingToDevice}, storedDocuments count: ${storedDocuments.length}`);

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Add Document to Browser Storage</CardTitle>
          <CardDescription>
            Upload EPUB, MOBI, PDF, TXT, or Image files. They will be stored in **this browser&apos;s internal storage (IndexedDB)**.
            Use &quot;Save to Device&quot; to save a copy to your computer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full max-w-md items-center gap-1.5">
            <Label htmlFor="doc-upload-library">Document File (.epub, .mobi, .pdf, .txt, .png, .jpg, etc.)</Label>
            <Input
              ref={fileInputRef}
              id="doc-upload-library"
              type="file"
              accept="application/epub+zip,application/x-mobipocket-ebook,application/pdf,text/plain,image/*"
              onChange={handleFileUpload}
              disabled={isUploading || isLoading}
            />
          </div>
          {isUploading && <p className="mt-2 text-sm text-muted-foreground flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing and saving to browser...</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BookOpen className="text-primary" /> Documents Stored in This Browser</CardTitle>
          <CardDescription>
            List of documents in this browser. Click &quot;Open in Reader&quot; to view.
          </CardDescription>
          <Button variant="outline" size="sm" onClick={() => fetchDocuments("Manual refresh of document list")} disabled={isLoading || isUploading} className="mt-2 w-fit">
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading && !isUploading ? 'animate-spin' : ''}`} /> Refresh List
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading && !storedDocuments.length && <p className="text-muted-foreground flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading documents...</p>}
          {!isLoading && storedDocuments.length === 0 && (
            <p className="text-muted-foreground">No documents found. Upload one to get started.</p>
          )}
          {storedDocuments.length > 0 && (
            <ul className="space-y-3">
              {storedDocuments.map(doc => {
                const currentDocId = doc.id; 
                const currentDocTitle = doc.title;
                // This isDeleteButtonDisabled logic will be used for the delete button
                const isDeleteButtonDisabled = isLoading || isUploading;
                
                console.log(`[LibraryPage] Rendering item: "${currentDocTitle}" (ID: ${currentDocId}). Delete button isDeleteButtonDisabled: ${isDeleteButtonDisabled}`);
                
                return (
                  <li key={currentDocId} className="p-3 border rounded-md flex flex-col sm:flex-row justify-between items-start gap-3 bg-card hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3 flex-grow min-w-0">
                      {getDocumentIcon(doc.type)}
                      <div className="min-w-0">
                        <p className="text-base font-medium truncate" title={currentDocTitle}>{currentDocTitle || 'Untitled Document'}</p>
                        <p className="text-xs text-muted-foreground">
                          Type: {doc.originalType || doc.type} | Stored: {new Date(doc.createdAt || 0).toLocaleDateString()}
                          {doc.type === 'pdf' && doc.numPages !== undefined && ` | Pages: ${doc.numPages}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2 sm:mt-0 sm:items-center flex-shrink-0">
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/reader?docId=${currentDocId}`}>
                          <BookOpen className="mr-1.5 h-4 w-4" /> Open in Reader
                        </Link>
                      </Button>
                      <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSaveToDevice(doc)}
                          disabled={isSavingToDevice === currentDocId || isUploading || isLoading}
                          className="w-[150px]"
                          title="Save a copy to your computer's file system."
                      >
                          {isSavingToDevice === currentDocId ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Save to Device
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          console.log(`[LibraryPage] Delete button onClick fired for docId: ${currentDocId}, title: "${currentDocTitle}"`);
                          handleDeleteDocument(currentDocId, currentDocTitle);
                        }}
                        disabled={isDeleteButtonDisabled}
                        aria-label="Delete Document">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
        {storedDocuments.length > 0 && (
          <CardFooter>
            <p className="text-xs text-muted-foreground">Documents are stored in your browser&apos;s IndexedDB. Clearing site data will remove them.</p>
          </CardFooter>
        )}
      </Card>

      <Card className="border-blue-500 bg-blue-500/5">
        <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-300"><Info className="h-6 w-6" /> Understanding &quot;Save to Device&quot;</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-blue-600 dark:text-blue-400/90">
            <p className="font-semibold text-base">
                &quot;Save to Device&quot; saves a copy of your browser-stored document to your computer.
            </p>
            <p>
                Modern browsers use the File System Access API for a &quot;Save As&quot; dialog. Older browsers use a standard download.
            </p>
        </CardContent>
      </Card>
    </div>
  );
}
    

    
