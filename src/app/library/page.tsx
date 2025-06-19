
"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { UploadCloud } from 'lucide-react';
import { uploadFileToLocalServer } from '@/lib/localFileService'; 

export default function LibraryPage() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const localUploadResult = await uploadFileToLocalServer(formData);

      if (localUploadResult.success) {
        toast({ title: "File Sent to Local Device", description: `${file.name} sent successfully. Path: ${localUploadResult.filePath}` });
      } else {
        toast({ variant: "destructive", title: "Local Save Failed", description: localUploadResult.message });
      }

    } catch (error: any) {
      toast({ variant: "destructive", title: "Upload Error", description: error.message || "An unknown error occurred while sending file to local service." });
    } finally {
        setIsLoading(false);
        if (event.target) (event.target as HTMLInputElement).value = ''; // Reset file input
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Upload Document to Local Device</CardTitle>
          <CardDescription>
            Upload TXT, PDF, or Image files. They will be sent to your local helper service for storage on your device.
            Ensure the local helper service is running on your computer. Documents are managed directly on your device, not in browser storage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full max-w-md items-center gap-1.5">
            <Label htmlFor="doc-upload-library">Document File (.txt, .pdf, .png, .jpg, etc.)</Label>
            <Input id="doc-upload-library" type="file" accept=".txt,application/pdf,image/*" onChange={handleFileUpload} disabled={isLoading} />
          </div>
          {isLoading && <p className="mt-2 text-sm text-muted-foreground">Sending file to local service...</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle>About Document Storage</CardTitle>
        </CardHeader>
        <CardContent>
            <p className="text-muted-foreground">
                This application now uses a local helper service to store your documents directly on your device (e.g., your computer). 
                You manage your files in the folder designated by the local helper service.
            </p>
            <p className="text-muted-foreground mt-2">
                To view or read documents, please use the "Read2" page to upload them for your current session, or open them directly from your local file system using your preferred applications.
            </p>
        </CardContent>
      </Card>

    </div>
  );
}
