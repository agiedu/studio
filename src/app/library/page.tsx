
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
  const [fileInputKey, setFileInputKey] = useState(Date.now()); // Used to reset file input

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      // The uploadFileToLocalServer function is a Server Action
      // It will attempt to send the file to http://localhost:3001/upload
      const localUploadResult = await uploadFileToLocalServer(formData);

      if (localUploadResult.success && localUploadResult.filePath) {
        toast({ title: "File Sent to Local Device", description: `${file.name} sent successfully. Path: ${localUploadResult.filePath}` });
      } else {
        // The message from localUploadResult.message will explain why it failed (e.g., "Failed to connect...")
        toast({ variant: "destructive", title: "Local Save Failed", description: `${localUploadResult.message || "Could not save to local device."}` });
      }

    } catch (error: any) {
      // This catch block is for unexpected errors during the Server Action call itself,
      // though uploadFileToLocalServer is designed to return structured errors.
      toast({ variant: "destructive", title: "Upload Error", description: error.message || "An unknown error occurred while sending file to local service." });
    } finally {
        setIsLoading(false);
        // Reset file input to allow uploading the same file again if needed
        setFileInputKey(Date.now());
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Upload Document to Your Local Device</CardTitle>
          <CardDescription>
            Use this page to send TXT, PDF, or Image files to your **local helper service**.
            Ensure the helper service (e.g., a Node.js script) is running on your computer, listening at `http://localhost:3001/upload`. 
            Documents will be saved directly to the folder configured in your local service.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full max-w-md items-center gap-1.5">
            <Label htmlFor="doc-upload-library">Document File (.txt, .pdf, .png, .jpg, etc.)</Label>
            <Input 
              key={fileInputKey} // Add key to allow resetting
              id="doc-upload-library" 
              type="file" 
              accept=".txt,application/pdf,image/*" 
              onChange={handleFileUpload} 
              disabled={isLoading} 
            />
          </div>
          {isLoading && <p className="mt-2 text-sm text-muted-foreground">Sending file to local service...</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle>Important Notes on Document Storage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
                This application sends uploaded documents to a **local helper service** that you must run on your own device (e.g., your computer). 
                The files are stored in a folder managed by that local helper service, not within this web application or your browser&apos;s limited storage.
            </p>
            <p>
                MangaTalk **does not display a list** of files stored by your local helper service. To manage or view these documents, please access them directly from the folder on your local file system where your helper service saves them.
            </p>
             <p>
                If you see errors like &quot;Failed to connect&quot; or &quot;fetch failed&quot;, it means this web application could not reach your local helper service at `http://localhost:3001/upload`. Please ensure your local service is running, accessible, and configured correctly.
            </p>
            <p>
                For reading documents within this application, please use the &quot;Read2&quot; page to upload them for your current session. These session files are also sent to your local helper service for persistent storage.
            </p>
        </CardContent>
      </Card>

    </div>
  );
}
