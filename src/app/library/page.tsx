
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

      if (localUploadResult.success && localUploadResult.filePath) {
        toast({ title: "File Sent to Local Device", description: `${file.name} sent successfully. Path: ${localUploadResult.filePath}` });
      } else {
        toast({ variant: "destructive", title: "Local Save Failed", description: `${localUploadResult.message || "Could not save to local device."}` });
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
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Upload Document to Your Local Device</CardTitle>
          <CardDescription>
            Use this page to send TXT, PDF, or Image files to your local helper service.
            Ensure the helper service is running on your computer. Documents will be saved directly to the folder configured in your local service.
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
        <CardContent className="space-y-2 text-muted-foreground">
            <p>
                This application sends uploaded documents to a **local helper service** that you run on your own device (e.g., your computer). 
                The files are stored in a folder managed by that local helper service, not within this web application or your browser's storage.
            </p>
            <p>
                MangaTalk **does not display a list** of files stored by your local helper service. To manage or view these documents, please access them directly from the folder on your local file system where your helper service saves them.
            </p>
            <p>
                For reading documents within this application, please use the "Read2" page to upload them for your current session.
            </p>
        </CardContent>
      </Card>

    </div>
  );
}
