
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
import type { StoredDocument, StoredTxtDocument, StoredPdfDocument, StoredImageDocument, Read2StoredDocument } from '@/types';
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
    const fileId = Date.now().toString();
    const commonDetails = {
      id: fileId,
      name: file.name,
      createdAt: Date.now(),
    };
    let shouldClearInput = true;
    let saveSuccess = false;

    try {
      if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        const textContent = await file.text();
        const newDoc: StoredTxtDocument = {
          ...commonDetails,
          type: 'txt',
          textContent,
        };
        saveSuccess = LocalStorage.addStoredDocument(newDoc);
        if (saveSuccess) {
          setGeneralDocuments(prev => [newDoc, ...prev].sort((a,b) => b.createdAt - a.createdAt));
          toast({ title: "Success", description: `${file.name} uploaded to general library.` });
        } else {
           toast({ variant: "destructive", title: "Storage Error", description: `Failed to save ${file.name}. Local storage might be full. Please delete some items from the library.` });
        }
      } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        shouldClearInput = false;
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
            const pdfSaveSuccess = LocalStorage.addStoredDocument(newDoc);
            if (pdfSaveSuccess) {
              setGeneralDocuments(prev => [newDoc, ...prev].sort((a,b) => b.createdAt - a.createdAt));
              toast({ title: "Success", description: `${file.name} uploaded to general library.` });
            } else {
                 toast({ variant: "destructive", title: "Storage Error", description: `Failed to save ${file.name}. Local storage might be full. Please delete some items from the library.` });
            }
          } else {
            toast({ variant: "destructive", title: "Error", description: "Could not read PDF file content." });
          }
          setIsLoading(false);
          if (event.target) (event.target as HTMLInputElement).value = '';
        };
        reader.onerror = () => {
          toast({ variant: "destructive", title: "Error", description: "Failed to read file." });
          setIsLoading(false);
          if (event.target) (event.target as HTMLInputElement).value = '';
        };
        reader.readAsDataURL(file);
        return;
      } else if (file.type.startsWith('image/')) {
         shouldClearInput = false;
        const reader = new FileReader();
        reader.onload = (e) => {
          const imageDataUrl = e.target?.result as string;
          if (imageDataUrl) {
            // Images uploaded via Library page go to the general library as StoredImageDocument without pre-extracted OCR text
            const newDoc: StoredImageDocument = {
              ...commonDetails,
              type: 'image',
              imageDataUrl,
              // extractedText is not set here, MangaRoom handles OCR for images from general library
            };
            const imageSaveSuccess = LocalStorage.addStoredDocument(newDoc);
             if (imageSaveSuccess) {
                setGeneralDocuments(prev => [newDoc, ...prev].sort((a,b) => b.createdAt - a.createdAt));
                toast({ title: "Success", description: `${file.name} (image) uploaded to general library.` });
            } else {
                toast({ variant: "destructive", title: "Storage Error", description: `Failed to save ${file.name}. Local storage might be full. Please delete some items from the library.` });
            }
          } else {
            toast({ variant: "destructive", title: "Error", description: "Could not read image file content." });
          }
          setIsLoading(false);
          if (event.target) (event.target as HTMLInputElement).value = '';
        };
        reader.onerror = () => {
          toast({ variant: "destructive", title: "Error", description: "Failed to read image file." });
          setIsLoading(false);
          if (event.target) (event.target as HTMLInputElement).value = '';
        };
        reader.readAsDataURL(file);
        return;
      } else {
        toast({ variant: "destructive", title: "Unsupported File", description: "Please upload a TXT, PDF, or Image file to the general library." });
      }

      // This specific check was for TXT files, but the else blocks for PDF/Image now also include the detailed toast.
      // It can be removed or kept for safety, though it might be redundant if `saveSuccess` covers all initial paths.
      if (!saveSuccess && (file.type === 'text/plain' || file.name.endsWith('.txt'))) {
        // This might be redundant if the initial saveSuccess block already handles it for TXT
        // toast({ variant: "destructive", title: "Storage Error", description: `Failed to save ${file.name}. Local storage might be full.` });
      }

    } catch (error: any) {
      toast({ variant: "destructive", title: "Upload Error", description: error.message || "An unknown error occurred." });
    } finally {
        if (shouldClearInput) {
            setIsLoading(false);
            if (event.target) (event.target as HTMLInputElement).value = '';
        }
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
      toast({ title: "Document Deleted", description: "The document has been removed." });
    } else {
      toast({ variant: "destructive", title: "Delete Error", description: "Failed to delete the document." });
    }
  };

  const handleReadDocument = (doc: StoredDocument | Read2StoredDocument, source: 'general' | 'read2') => {
    if (source === 'read2') {
      // All Read2 documents (images with OCR or PDFs) go to MangaRoom
      router.push(`/?loadFromLibraryId=${doc.id}&source=read2`);
    } else { // General library
      if (doc.type === 'image') {
        // Images from general library also go to MangaRoom for OCR
        router.push(`/?loadFromLibraryId=${doc.id}&source=general`);
      } else { // TXT and PDF from general library go to ReaderPage
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
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          {docs.length === 0 ? (
             <p className="text-muted-foreground flex items-center gap-2"><Info className="h-5 w-5" /> This library section is empty.</p>
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
                      Type: {doc.type.toUpperCase()} | Added: {format(new Date(doc.createdAt), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                  <div className="flex gap-2 mt-2 sm:mt-0 flex-shrink-0">
                    <Button size="sm" variant="outline" onClick={() => handleReadDocument(doc, source)} disabled={isLoading}>
                      {source === 'read2' || doc.type === 'image' ? <Home className="mr-1.5 h-4 w-4" /> : <BookOpen className="mr-1.5 h-4 w-4" />}
                      Read {source === 'read2' || doc.type === 'image' ? 'in Read2' : 'in Reader'}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDeleteDocument(doc.id, source)} disabled={isLoading}>
                      <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        {docs.length > 0 && (
          <CardFooter>
            <p className="text-xs text-muted-foreground">Documents are stored in your browser's local storage.</p>
          </CardFooter>
        )}
      </Card>
    );
  }


  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Upload to General Library</CardTitle>
          <CardDescription>Upload TXT, PDF, or Image files here. TXT/PDFs open in Reader, Images open in Read2 for OCR.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full max-w-md items-center gap-1.5">
            <Label htmlFor="doc-upload-library">Document File (.txt, .pdf, .png, .jpg, etc.)</Label>
            <Input id="doc-upload-library" type="file" accept=".txt,application/pdf,image/*" onChange={handleFileUpload} disabled={isLoading} />
          </div>
          {isLoading && <p className="mt-2 text-sm text-muted-foreground">Processing file...</p>}
        </CardContent>
      </Card>

      {renderDocumentList(generalDocuments, 'general', "My General Library", "Documents for text reader or Read2 (images).")}
      {renderDocumentList(read2Documents, 'read2', "Manga Room Uploads", "Images (with OCR) and PDFs uploaded directly in Read2.")}

    </div>
  );
}

