
"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { UploadCloud, BookOpen, Trash2, FileText, FileType2, Image as ImageIcon, Info, Home } from 'lucide-react';
import * as LocalStorage from '@/lib/localStorageService';
import { uploadFileToLocalServer } from '@/lib/localFileService'; 
import type { StoredDocument, Read2StoredDocument } from '@/types'; 
import { format } from 'date-fns';

export default function LibraryPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [generalDocuments, setGeneralDocuments] = useState<StoredDocument[]>([]);
  const [read2Documents, setRead2Documents] = useState<Read2StoredDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setGeneralDocuments(LocalStorage.loadStoredDocuments());
    setRead2Documents(LocalStorage.loadRead2StoredDocuments());
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const localUploadResult = await uploadFileToLocalServer(formData);

      if (localUploadResult.success) {
        toast({ title: "File Sent to Local Device", description: `${file.name} sent to local service. Path: ${localUploadResult.filePath}` });
      } else {
        toast({ variant: "destructive", title: "Local Save Failed", description: localUploadResult.message });
      }

    } catch (error: any) {
      toast({ variant: "destructive", title: "Upload Error", description: error.message || "An unknown error occurred." });
    } finally {
        setIsLoading(false);
        if (event.target) (event.target as HTMLInputElement).value = '';
    }
  };

  const handleDeleteDocument = (docId: string, source: 'general' | 'read2') => {
    let success = false;
    if (source === 'general') {
      success = LocalStorage.deleteStoredDocument(docId);
      if (success) setGeneralDocuments(prev => prev.filter(doc => doc.id !== docId));
    } else {
      success = LocalStorage.deleteRead2StoredDocument(docId);
      if (success) setRead2Documents(prev => prev.filter(doc => doc.id !== docId));
    }
    if (success) {
      toast({ title: "Document Deleted from Browser Storage", description: "The document has been removed from browser's local storage." });
    } else {
      toast({ variant: "destructive", title: "Delete Error", description: "Failed to delete the document from browser storage." });
    }
  };

  const handleReadDocument = (doc: StoredDocument | Read2StoredDocument, source: 'general' | 'read2') => {
    if (source === 'read2') {
      router.push(`/?loadFromLibraryId=${doc.id}&source=read2`);
    } else { 
      if (doc.type === 'image' || doc.type === 'pdf') { // Also allow PDF from general to load in Read2
        router.push(`/?loadFromLibraryId=${doc.id}&source=general`);
      } else { 
        router.push(`/reader?docId=${doc.id}`);
      }
    }
  };

  const getFileIcon = (type: StoredDocument['type'] | Read2StoredDocument['type']) => {
    switch(type) {
      case 'txt': return <FileText className="h-5 w-5 text-blue-500" />;
      case 'pdf': return <FileType2 className="h-5 w-5 text-red-500" />;
      case 'image': return <ImageIcon className="h-5 w-5 text-green-500" />;
      default: return <FileText className="h-5 w-5 text-gray-500" />;
    }
  }

  const renderDocumentList = (docs: (StoredDocument | Read2StoredDocument)[], source: 'general' | 'read2', title: string, description: string) => {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description} (These are from browser's local storage. New uploads go to your device via a local service.)</CardDescription>
        </CardHeader>
        <CardContent>
          {docs.length === 0 ? (
             <p className="text-muted-foreground flex items-center gap-2"><Info className="h-5 w-5" /> This browser storage section is empty.</p>
          ) : (
            <ul className="space-y-3">
              {docs.map(doc => (
                <li key={doc.id} className="p-3 border rounded-md flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-card hover:shadow-md transition-shadow">
                  <div className="flex-grow">
                    <h3 className="font-semibold flex items-center gap-1.5">
                      {getFileIcon(doc.type)}
                      {doc.name}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Type: {doc.type.toUpperCase()} | Added: {format(new Date(doc.createdAt), "MMM d, yyyy HH:mm")} (In Browser Storage)
                    </p>
                  </div>
                  <div className="flex gap-2 mt-2 sm:mt-0 flex-shrink-0">
                    <Button size="sm" variant="outline" onClick={() => handleReadDocument(doc, source)} disabled={isLoading}>
                      {source === 'read2' || doc.type === 'image' || doc.type === 'pdf' ? <Home className="mr-1.5 h-4 w-4" /> : <BookOpen className="mr-1.5 h-4 w-4" />}
                      Read {source === 'read2' || doc.type === 'image' || doc.type === 'pdf' ? 'in Read2' : 'in Reader'}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDeleteDocument(doc.id, source)} disabled={isLoading}>
                      <Trash2 className="mr-1.5 h-4 w-4" /> Delete (from Browser)
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        {docs.length > 0 && (
          <CardFooter>
            <p className="text-xs text-muted-foreground">These documents are stored in your browser's local storage. New uploads are now sent to your local device.</p>
          </CardFooter>
        )}
      </Card>
    );
  }


  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Upload to Local Device</CardTitle>
          <CardDescription>Upload TXT, PDF, or Image files. They will be sent to your local helper service for storage. Ensure the service is running.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full max-w-md items-center gap-1.5">
            <Label htmlFor="doc-upload-library">Document File (.txt, .pdf, .png, .jpg, etc.)</Label>
            <Input id="doc-upload-library" type="file" accept=".txt,application/pdf,image/*" onChange={handleFileUpload} disabled={isLoading} />
          </div>
          {isLoading && <p className="mt-2 text-sm text-muted-foreground">Sending file to local service...</p>}
        </CardContent>
      </Card>

      {renderDocumentList(generalDocuments, 'general', "Browser Storage - General Library", "Documents previously saved in browser storage.")}
      {renderDocumentList(read2Documents, 'read2', "Browser Storage - Manga Room Uploads", "Images/PDFs previously saved in browser storage from Read2.")}

    </div>
  );
}
