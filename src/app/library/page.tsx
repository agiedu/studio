
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { UploadCloud, AlertTriangle, Info, ServerCrash, Trash2, BookOpen, FileText, Image as ImageIcon, RefreshCw, Loader2, Save } from 'lucide-react';
import * as IndexedDBService from '@/lib/indexedDBService';
import type { StoredMangaDocument } from '@/types';
import { uploadFileToLocalServer } from '@/lib/localFileService'; // Still needed for "Sync to Device"

export default function LibraryPage() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false); // For initial page load of documents
  const [isUploading, setIsUploading] = useState(false); // For new file uploads
  const [isSyncing, setIsSyncing] = useState<string | null>(null); // docId of file being synced
  const [storedDocuments, setStoredDocuments] = useState<StoredMangaDocument[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    try {
      const docs = await IndexedDBService.getAllDocuments();
      setStoredDocuments(docs.sort((a, b) => b.createdAt - a.createdAt)); // Sort by newest first
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error Loading Documents", description: `Could not load documents from browser storage. ${error.message}` });
      console.error("[LibraryPage] Error fetching documents from IndexedDB:", error);
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const docId = `doc_${Date.now()}`;

    try {
      const fileBuffer = await file.arrayBuffer();
      let docToStore: StoredMangaDocument;

      if (file.type.startsWith('image/')) {
        // For library upload, we might not run OCR immediately to speed up listing.
        // OCR can be done when the document is opened in MangaRoom.
        docToStore = {
          id: docId,
          title: file.name,
          type: 'image',
          fileData: fileBuffer,
          originalType: file.type,
          // imageDataUrl: can be generated on demand or when opened
          extractedText: undefined, // OCR will be done when opened in MangaRoom
          createdAt: Date.now(),
        };
      } else if (file.type === 'application/pdf') {
        // We need numPages for PDF, so a quick parse is good.
        // const { getDocument } = await import('pdfjs-dist');
        // Could also import pdfjsVersion if needed for workerSrc but it's global.
        // GlobalWorkerOptions.workerSrc is set in MangaRoom, assuming it runs first or is set globally.
        const { getDocument } = await import('pdfjs-dist');
        const pdfLoadingTask = getDocument({ data: fileBuffer.slice(0) });
        const pdfInstance = await pdfLoadingTask.promise;

        docToStore = {
          id: docId,
          title: file.name,
          type: 'pdf',
          fileData: fileBuffer,
          originalType: file.type,
          numPages: pdfInstance.numPages,
          createdAt: Date.now(),
        };
      } else {
        toast({ variant: "destructive", title: "Unsupported File", description: "Please upload an Image or PDF file." });
        setIsUploading(false);
        return;
      }

      await IndexedDBService.saveDocument(docToStore);
      toast({ title: "Document Saved in Browser", description: `"${file.name}" has been saved to your browser's internal storage.` });
      fetchDocuments(); // Refresh the list

    } catch (error: any) {
      toast({ variant: "destructive", title: "Upload & Save Error", description: `Failed to process and save "${file.name}" to browser. ${error.message}` });
      console.error("[LibraryPage] Error handling file upload:", error);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = ""; // Reset file input
      }
    }
  };

  const handleDeleteDocument = async (docId: string, docTitle?: string) => {
    if (!window.confirm(`Are you sure you want to delete "${docTitle || 'this document'}" from your browser storage? This action cannot be undone.`)) {
      return;
    }
    try {
      await IndexedDBService.deleteDocumentById(docId);
      toast({ title: "Document Deleted", description: `"${docTitle || 'Document'}" removed from browser storage.` });
      fetchDocuments(); // Refresh list
      // Also clear from last active if it was the one
      const lastActiveId = await IndexedDBService.getLastActiveDocId();
      if (lastActiveId === docId) {
        await IndexedDBService.saveLastActiveDocId(null);
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Delete Error", description: `Failed to delete document. ${error.message}` });
      console.error("[LibraryPage] Error deleting document from IndexedDB:", error);
    }
  };

  const handleSyncToDevice = async (doc: StoredMangaDocument) => {
    if (!doc.fileData || !doc.title || !doc.originalType) {
        toast({variant: "destructive", title: "Sync Error", description: "Document data is incomplete for syncing."});
        return;
    }
    setIsSyncing(doc.id);
    toast({ title: "Syncing to Local Device", description: `Attempting to send "${doc.title}" to your local helper service...` });

    try {
      const file = new File([doc.fileData], doc.title, { type: doc.originalType });
      const formData = new FormData();
      formData.append('file', file);

      const localUploadResult = await uploadFileToLocalServer(formData);

      if (localUploadResult && localUploadResult.success && localUploadResult.filePath) {
          toast({ title: "Synced to Local Device", description: `"${doc.title}" successfully sent. Path: ${localUploadResult.filePath}` });
      } else {
          let description = `Could not sync "${doc.title}" to local device. Ensure the helper service is running.`;
          if (localUploadResult && typeof localUploadResult === 'object' && Object.keys(localUploadResult).length === 0) {
            description = `Sync of "${doc.title}" failed: The application received an empty response from the server. Check Next.js server console and helper service logs.`;
          } else if (localUploadResult && localUploadResult.message) {
            description = `Sync of "${doc.title}" failed: ${localUploadResult.message}`;
          }
          toast({ variant: "destructive", title: "Local Sync Failed", description });
          console.error(`[LibraryPage] Local sync failed for "${doc.title}". Server Action Response:`, localUploadResult);
      }
    } catch (uploadError: any) {
        const clientErrorMsg = uploadError.message || "An unknown error occurred while trying to sync the file.";
        toast({ variant: "destructive", title: "Local Sync Service Error", description: clientErrorMsg });
        console.error(`[LibraryPage] Error calling uploadFileToLocalServer action for sync of "${doc.title}":`, uploadError);
    } finally {
        setIsSyncing(null);
    }
  };


  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Add Document to Browser Storage</CardTitle>
          <CardDescription>
            Upload TXT, PDF, or Image files to store them directly in this browser using IndexedDB.
            These documents will be available for offline reading within this application.
            You can later choose to "Sync to Device" to also save a copy to your computer's file system via the local helper service.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full max-w-md items-center gap-1.5">
            <Label htmlFor="doc-upload-library">Document File (.pdf, .png, .jpg, etc.)</Label>
            <Input
              ref={fileInputRef}
              id="doc-upload-library"
              type="file"
              accept="application/pdf,image/*"
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
            Below is a list of documents currently stored in your browser's IndexedDB.
            Click "Open" to read them in the Read2 page. You can also delete them or attempt to sync them to your local device.
          </CardDescription>
          <Button variant="outline" size="sm" onClick={fetchDocuments} disabled={isLoading} className="mt-2 w-fit">
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh List
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading && !storedDocuments.length && <p className="text-muted-foreground flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading documents...</p>}
          {!isLoading && storedDocuments.length === 0 && (
            <p className="text-muted-foreground">No documents found in your browser storage. Upload one above to get started.</p>
          )}
          {storedDocuments.length > 0 && (
            <ul className="space-y-3">
              {storedDocuments.map(doc => (
                <li key={doc.id} className="p-3 border rounded-md flex flex-col sm:flex-row justify-between items-start gap-3 bg-card hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 flex-grow min-w-0">
                    {doc.type === 'pdf' ? <FileText className="h-8 w-8 text-primary flex-shrink-0" /> : <ImageIcon className="h-8 w-8 text-primary flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-base font-medium truncate" title={doc.title}>{doc.title || 'Untitled Document'}</p>
                      <p className="text-xs text-muted-foreground">
                        Type: {doc.originalType} | Stored: {new Date(doc.createdAt).toLocaleDateString()}
                        {doc.type === 'pdf' && doc.numPages && ` | Pages: ${doc.numPages}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2 sm:mt-0 sm:items-center flex-shrink-0">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/?docId=${doc.id}`}> {/* Updated to point to Read2 (MangaRoom) page */}
                        <BookOpen className="mr-1.5 h-4 w-4" /> Open
                      </Link>
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSyncToDevice(doc)}
                        disabled={isSyncing === doc.id || isUploading}
                        className="w-[140px]"
                        title="Saves a copy to your computer via the local helper service."
                    >
                        {isSyncing === doc.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Sync to Device
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDeleteDocument(doc.id, doc.title)} disabled={isUploading || !!isSyncing} aria-label="Delete Document">
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
            <p className="text-xs text-muted-foreground">These documents are stored in your browser's IndexedDB. Clearing your browser's site data for MangaTalk will remove them.</p>
          </CardFooter>
        )}
      </Card>


      <Card className="border-destructive bg-destructive/5">
        <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive-foreground"><ServerCrash className="h-6 w-6" /> Local Helper Service for "Sync to Device"</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-destructive-foreground/90">
            <p className="font-semibold text-base">
                The "Sync to Device" feature allows you to save a copy of your browser-stored documents to your computer's actual file system (e.g., "Downloads" or "Documents" folder).
                This requires the **MangaTalk local helper service** to be running on your computer.
            </p>
            <p className="font-medium">
                If "Sync to Device" fails (e.g., with errors like <span className="font-bold">&quot;Failed to connect,&quot;</span> <span className="font-bold">&quot;fetch failed,&quot;</span> or <span className="font-bold">&quot;Connection Refused&quot;</span>), it means this local helper service is **NOT RUNNING**, is blocked by a firewall, or is not accessible at `http://localhost:3001/upload`.
            </p>
             <p className="font-semibold mt-3">Troubleshooting "Sync to Device":</p>
             <ol className="list-decimal pl-5 space-y-1.5">
                <li><strong>START THE HELPER SERVICE:</strong> Open a terminal/command prompt, navigate to the directory containing your helper service script (e.g., `server.js`), and run it (e.g., <code className="bg-destructive/20 px-1 py-0.5 rounded">node server.js</code>).</li>
                <li><strong>CHECK ITS CONSOLE OUTPUT:</strong> Look at the terminal output of your helper service. It should clearly indicate that it's running and listening on port 3001 (or similar). **Check for any error messages there.** This is the most important step for debugging.</li>
                <li><strong>VERIFY URL & PORT:</strong> Confirm your helper service is configured to listen for uploads at `http://localhost:3001/upload` and sends back JSON responses like `{"status":"ok", "path":"..."}`.</li>
                <li><strong>FIREWALL:</strong> Ensure your computer's firewall is not blocking incoming connections to port 3001 for the helper service application (Node.js, Python, etc.).</li>
                <li><strong>RETRY SYNC:</strong> After verifying the above, try the "Sync to Device" button again.</li>
                <li><strong>CHECK NEXT.JS SERVER CONSOLE:</strong> Also check the console where you run MangaTalk (`npm run dev`) for detailed error messages from the Server Action if the sync fails.</li>
            </ol>
            <p className="mt-3">
                Remember: Your documents are primarily stored in this browser. "Sync to Device" is an additional backup. If it fails, your documents remain safe in the browser storage.
            </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-2"><Info className="h-5 w-5" /> Manual Local Saving (Alternative)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
                If your local helper service is unavailable or you prefer direct control for saving files shown in the MangaTalk reader:
            </p>
             <ul className="list-disc pl-5 space-y-1">
                <li><strong>Save Page As (for rendered content):</strong> Right-click and select "Save Page As..." or use your browser's menu.</li>
                <li><strong>Print to PDF:</strong> Most browsers allow you to "Print" a page and choose "Save as PDF".</li>
                <li><strong>Screenshots:</strong> For visual content, taking screenshots is always an option.</li>
                <li><strong>Developer Tools:</strong> For PDFs or images displayed, you might be able_ to find the source (e.g., blob URL) in developer tools and save it directly, though this is technical.</li>
            </ul>
            <p className="font-medium mt-2">
                These manual methods are workarounds and do not use the "Sync to Device" feature, which relies on an **operational local helper service.**
            </p>
        </CardContent>
      </Card>

    </div>
  );
}
