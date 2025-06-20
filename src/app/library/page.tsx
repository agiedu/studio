
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { UploadCloud, AlertTriangle, Info, ServerCrash, Trash2, BookOpen, FileText, Image as ImageIcon, RefreshCw, Loader2, Save, FileType2, Book } from 'lucide-react';
import * as IndexedDBService from '@/lib/indexedDBService';
import type { StoredMangaDocument } from '@/types';
import { getDocument, GlobalWorkerOptions, version as pdfjsVersion } from 'pdfjs-dist';


function arrayBufferToBlob(buffer: ArrayBuffer, type: string): Blob {
  return new Blob([buffer], { type });
}

export default function LibraryPage() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingToDevice, setIsSavingToDevice] = useState<string | null>(null);
  const [storedDocuments, setStoredDocuments] = useState<StoredMangaDocument[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchDocuments = useCallback(async () => {
    console.log("[LibraryPage] Fetching documents...");
    setIsLoading(true);
    try {
      const docs = await IndexedDBService.getAllDocuments();
      console.log(`[LibraryPage] Fetched ${docs.length} documents.`);
      setStoredDocuments(docs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error Loading Documents", description: `Could not load documents from browser storage. ${error.message}` });
      console.error("[LibraryPage] Error fetching documents from IndexedDB:", error);
    } finally {
      setIsLoading(false);
      console.log("[LibraryPage] Finished fetching documents.");
    }
  }, [toast]);

  useEffect(() => {
    fetchDocuments();
     if (typeof window !== 'undefined' && !GlobalWorkerOptions.workerSrc) {
        GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.mjs`;
    }
  }, [fetchDocuments]);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const docId = `doc_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    let newDocument: StoredMangaDocument | null = null;

    try {
      const fileBuffer = await file.arrayBuffer();
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
            const pdfLoadingTask = getDocument({ data: fileBuffer.slice(0) }); // Use a copy of the buffer
            const pdfInstance = await pdfLoadingTask.promise;
            newDocument = { ...commonDocProps, type: 'pdf', numPages: pdfInstance.numPages, ocrTextPerPage: {} };
          } catch (pdfError: any) {
            console.warn(`[LibraryPage] Could not get PDF page count for ${file.name}:`, pdfError);
            toast({ variant: "default", title: "PDF Info", description: `Uploaded PDF "${file.name}". Page count determination issue: ${pdfError.message}.` });
            newDocument = { ...commonDocProps, type: 'pdf', numPages: undefined, ocrTextPerPage: {} }; // Still save if page count fails
          }
      } else if (file.type === 'application/epub+zip' || file.name.toLowerCase().endsWith('.epub')) {
        newDocument = { ...commonDocProps, type: 'epub', originalType: 'application/epub+zip' };
      } else if (file.type === 'application/x-mobipocket-ebook' || file.name.toLowerCase().endsWith('.mobi')) {
        newDocument = { ...commonDocProps, type: 'mobi', originalType: 'application/x-mobipocket-ebook' };
      } else if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
        newDocument = { ...commonDocProps, type: 'txt', originalType: 'text/plain' };
      } else {
        toast({ variant: "destructive", title: "Unsupported File Type", description: `Files of type "${file.type || 'unknown'}" (${file.name}) are not supported. Please upload Image, PDF, EPUB, MOBI, or TXT.` });
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      if (newDocument) {
        await IndexedDBService.saveDocument(newDocument);
        toast({ title: "Document Saved in Browser", description: `"${newDocument.title}" has been saved to your browser's internal storage.` });
        fetchDocuments(); 
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Upload & Save Error", description: `Failed to process and save "${file.name}" to browser. ${error.message}` });
      console.error(`[LibraryPage] Error handling file upload for "${file.name}":`, error);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [fetchDocuments, toast]);

  const handleDeleteDocument = useCallback(async (docId: string, docTitle?: string) => {
    const titleForConfirm = docTitle || 'this document';
    console.log(`[LibraryPage] handleDeleteDocument called for docId: ${docId}, title: "${titleForConfirm}"`);

    if (!docId || typeof docId !== 'string' || docId.trim() === "") {
      console.error("[LibraryPage] handleDeleteDocument: Invalid docId provided. Aborting.", docId);
      toast({ variant: "destructive", title: "Delete Error", description: "Cannot delete document: Document ID is invalid." });
      return;
    }

    if (!window.confirm(`Are you sure you want to delete "${titleForConfirm}" from your browser storage? This action cannot be undone.`)) {
      console.log(`[LibraryPage] Deletion cancelled by user for document: ${docId}`);
      return;
    }
    
    console.log(`[LibraryPage] User confirmed deletion for document: ${docId}`);

    try {
      console.log(`[LibraryPage] Attempting to delete document via IndexedDBService.deleteDocumentById for docId: ${docId}`);
      await IndexedDBService.deleteDocumentById(docId);
      console.log(`[LibraryPage] IndexedDBService.deleteDocumentById promise resolved for docId: ${docId}.`);
      
      setStoredDocuments(prevDocs => {
        const updatedDocs = prevDocs.filter(doc => doc.id !== docId);
        console.log(`[LibraryPage] Manually filtered storedDocuments. Prev count: ${prevDocs.length}, New count: ${updatedDocs.length}. DocId for removal: ${docId}`);
        return updatedDocs;
      });
      
      const lastActiveId = await IndexedDBService.getLastActiveDocId();
      console.log(`[LibraryPage] Last active docId was: ${lastActiveId}`);
      if (lastActiveId === docId) {
        console.log(`[LibraryPage] Clearing last active docId because it matches deleted docId: ${docId}`);
        await IndexedDBService.saveLastActiveDocId(null);
        console.log(`[LibraryPage] Last active docId cleared or attempt finished.`);
      }
      
      toast({ title: "Document Deleted", description: `"${titleForConfirm}" removed from browser storage.` });
      console.log(`[LibraryPage] Document deletion process for ${docId} completed successfully in try block. Now calling fetchDocuments for consistency.`);
      fetchDocuments(); // Re-fetch for full consistency after all operations.

    } catch (error:any) {
      console.error(`[LibraryPage] Error during deletion process for document "${docId}":`, error);
      toast({ variant: "destructive", title: "Delete Error", description: `Failed to delete document "${titleForConfirm}". ${error.message}. Please refresh the page.` });
      fetchDocuments(); // Fetch documents even on error to try and resync UI with DB state
    }
  }, [fetchDocuments, toast]);

  const handleSaveToDevice = useCallback(async (doc: StoredMangaDocument) => {
    if (!doc.fileData || !doc.title || !doc.originalType) {
        toast({variant: "destructive", title: "Save Error", description: "Document data is incomplete for saving."});
        return;
    }
    setIsSavingToDevice(doc.id);
    toast({ title: "Saving to Device", description: `Preparing "${doc.title}" for saving...` });

    try {
      const blob = arrayBufferToBlob(doc.fileData, doc.originalType);
      
      if (typeof window.showSaveFilePicker === 'function') {
        const suggestedName = doc.title;
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: suggestedName,
          types: [
            {
              description: 'Document', 
              accept: { [doc.originalType]: [`.${doc.title.split('.').pop() || 'bin'}`] },
            },
          ],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        toast({ title: "Saved to Device", description: `"${doc.title}" successfully saved.` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.title;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast({ title: "Download Started", description: `"${doc.title}" is downloading.` });
      }
    } catch (error: any) {
        if (error.name === 'AbortError') {
          toast({ variant: "default", title: "Save Cancelled", description: "File saving was cancelled by the user." });
        } else {
          toast({ variant: "destructive", title: "Save to Device Failed", description: `Could not save "${doc.title}". ${error.message}` });
          console.error(`[LibraryPage] Error saving file "${doc.title}" to device:`, error);
        }
    } finally {
        setIsSavingToDevice(null);
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

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Add Document to Browser Storage</CardTitle>
          <CardDescription>
            Upload EPUB, MOBI, PDF, TXT, or Image files. They will be stored directly in **this browser&apos;s internal storage (IndexedDB)**.
            Use the &quot;Save to Device&quot; button to save a copy to your computer&apos;s file system.
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
          {isUploading && <p className="mt-2 text-sm text-muted-foreground flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing and saving file to browser...</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BookOpen className="text-primary" /> Documents Stored in This Browser</CardTitle>
          <CardDescription>
            Below is a list of documents currently stored in this browser.
            Click &quot;Open in Reader&quot; to view.
          </CardDescription>
          <Button variant="outline" size="sm" onClick={fetchDocuments} disabled={isLoading || isUploading} className="mt-2 w-fit">
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh List
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading && !storedDocuments.length && <p className="text-muted-foreground flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading documents...</p>}
          {!isLoading && storedDocuments.length === 0 && (
            <p className="text-muted-foreground">No documents found. Upload one above to get started.</p>
          )}
          {storedDocuments.length > 0 && (
            <ul className="space-y-3">
              {storedDocuments.map(doc => (
                <li key={doc.id} className="p-3 border rounded-md flex flex-col sm:flex-row justify-between items-start gap-3 bg-card hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 flex-grow min-w-0">
                    {getDocumentIcon(doc.type)}
                    <div className="min-w-0">
                      <p className="text-base font-medium truncate" title={doc.title}>{doc.title || 'Untitled Document'}</p>
                      <p className="text-xs text-muted-foreground">
                        Type: {doc.originalType} | Stored: {new Date(doc.createdAt || 0).toLocaleDateString()}
                        {doc.type === 'pdf' && doc.numPages !== undefined && ` | Pages: ${doc.numPages}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2 sm:mt-0 sm:items-center flex-shrink-0">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/reader?docId=${doc.id}`}>
                        <BookOpen className="mr-1.5 h-4 w-4" /> Open in Reader
                      </Link>
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSaveToDevice(doc)}
                        disabled={isSavingToDevice === doc.id || isUploading}
                        className="w-[150px]"
                        title="Saves a copy to your computer's file system."
                    >
                        {isSavingToDevice === doc.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Save to Device
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => handleDeleteDocument(doc.id, doc.title)} 
                      disabled={isUploading || !!isSavingToDevice} 
                      aria-label="Delete Document">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        {storedDocuments.length > 0 && (
          <CardFooter>
            <p className="text-xs text-muted-foreground">These documents are stored in your browser&apos;s IndexedDB. Clearing site data for MangaTalk will remove them.</p>
          </CardFooter>
        )}
      </Card>

      <Card className="border-blue-500 bg-blue-500/5">
        <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-300"><Info className="h-6 w-6" /> Understanding &quot;Save to Device&quot;</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-blue-600 dark:text-blue-400/90">
            <p className="font-semibold text-base">
                The &quot;Save to Device&quot; button allows you to save a copy of your browser-stored document to your computer.
            </p>
            <p>
                Modern browsers use the File System Access API for a native &quot;Save As&quot; dialog. Older browsers will use a standard download.
            </p>
        </CardContent>
      </Card>
    </div>
  );
}
    
