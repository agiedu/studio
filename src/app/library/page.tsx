
"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { UploadCloud, BookOpen, Trash2, FileText, FileType2, Image as ImageIcon } from 'lucide-react';
import * as LocalStorage from '@/lib/localStorageService';
import type { StoredDocument, StoredTxtDocument, StoredPdfDocument, StoredImageDocument } from '@/types';
import { format } from 'date-fns';

export default function LibraryPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setDocuments(LocalStorage.loadStoredDocuments());
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    const fileId = Date.now().toString();
    const commonDetails = {
      id: fileId,
      name: file.name,
      createdAt: Date.now(),
    };

    try {
      if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        const textContent = await file.text();
        const newDoc: StoredTxtDocument = {
          ...commonDetails,
          type: 'txt',
          textContent,
        };
        LocalStorage.addStoredDocument(newDoc);
        setDocuments(prev => [newDoc, ...prev]);
        toast({ title: "Success", description: `${file.name} uploaded.` });
      } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const pdfDataUrl = e.target?.result as string;
          const pdfBase64 = pdfDataUrl.split(',')[1];
          if (pdfBase64) {
            const newDoc: StoredPdfDocument = {
              ...commonDetails,
              type: 'pdf',
              pdfBase64,
            };
            LocalStorage.addStoredDocument(newDoc);
            setDocuments(prev => [newDoc, ...prev]);
            toast({ title: "Success", description: `${file.name} uploaded.` });
          } else {
            toast({ variant: "destructive", title: "Error", description: "Could not read PDF file content." });
          }
          setIsLoading(false);
        };
        reader.onerror = () => {
          toast({ variant: "destructive", title: "Error", description: "Failed to read file." });
          setIsLoading(false);
        };
        reader.readAsDataURL(file);
        return; 
      } else if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const imageDataUrl = e.target?.result as string;
          if (imageDataUrl) {
            const newDoc: StoredImageDocument = {
              ...commonDetails,
              type: 'image',
              imageDataUrl,
            };
            LocalStorage.addStoredDocument(newDoc);
            setDocuments(prev => [newDoc, ...prev]);
            toast({ title: "Success", description: `${file.name} (image) uploaded.` });
          } else {
            toast({ variant: "destructive", title: "Error", description: "Could not read image file content." });
          }
          setIsLoading(false);
        };
        reader.onerror = () => {
          toast({ variant: "destructive", title: "Error", description: "Failed to read image file." });
          setIsLoading(false);
        };
        reader.readAsDataURL(file);
        return;
      }
      else {
        toast({ variant: "destructive", title: "Unsupported File", description: "Please upload a TXT, PDF, or Image file." });
         setIsLoading(false);
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Upload Error", description: error.message || "An unknown error occurred." });
       setIsLoading(false);
    }
    // setIsLoading(false) // This will be called for non-async paths or after await for txt
    if (event.target) event.target.value = ''; 
  };

  const handleDeleteDocument = (docId: string) => {
    LocalStorage.deleteStoredDocument(docId);
    setDocuments(prev => prev.filter(doc => doc.id !== docId));
    toast({ title: "Document Deleted", description: "The document has been removed from your library." });
  };

  const handleReadDocument = (doc: StoredDocument) => {
    if (doc.type === 'image') {
      router.push(`/read2?loadFromLibraryId=${doc.id}`); // Navigate image types to MangaRoom (/read2)
    } else {
      router.push(`/reader?docId=${doc.id}`); // TXT and PDF go to Reader page
    }
  };

  const getFileIcon = (type: StoredDocument['type']) => {
    switch(type) {
      case 'txt': return <FileText className="h-5 w-5 text-blue-500" />;
      case 'pdf': return <FileType2 className="h-5 w-5 text-red-500" />;
      case 'image': return <ImageIcon className="h-5 w-5 text-green-500" />;
      default: return <FileText className="h-5 w-5 text-gray-500" />;
    }
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Upload to Library</CardTitle>
          <CardDescription>Upload TXT, PDF, or Image files to store them locally for reading.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full max-w-md items-center gap-1.5">
            <Label htmlFor="doc-upload-library">Document File (.txt, .pdf, .png, .jpg, etc.)</Label>
            <Input id="doc-upload-library" type="file" accept=".txt,application/pdf,image/*" onChange={handleFileUpload} disabled={isLoading} />
          </div>
          {isLoading && <p className="mt-2 text-sm text-muted-foreground">Processing file...</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My Library</CardTitle>
          <CardDescription>Stored documents. Click "Read" to open.</CardDescription>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="text-muted-foreground">Your library is empty. Upload some documents to get started!</p>
          ) : (
            <ul className="space-y-3">
              {documents.map(doc => (
                <li key={doc.id} className="p-3 border rounded-md flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-card hover:shadow-md transition-shadow">
                  <div className="flex-grow">
                    <h3 className="font-semibold flex items-center gap-1.5">
                      {getFileIcon(doc.type)}
                      {doc.name}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Type: {doc.type.toUpperCase()} | Added: {format(new Date(doc.createdAt), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                  <div className="flex gap-2 mt-2 sm:mt-0 flex-shrink-0">
                    <Button size="sm" variant="outline" onClick={() => handleReadDocument(doc)} disabled={isLoading}>
                      <BookOpen className="mr-1.5 h-4 w-4" /> Read
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDeleteDocument(doc.id)} disabled={isLoading}>
                      <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        {documents.length > 0 && (
          <CardFooter>
            <p className="text-xs text-muted-foreground">Your documents are stored in your browser's local storage.</p>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}

