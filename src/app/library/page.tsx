
"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { UploadCloud, AlertTriangle } from 'lucide-react';
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
            This application **does not store or list these documents in the browser**. All uploaded files are sent directly to the helper service running on your computer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full max-w-md items-center gap-1.5">
            <Label htmlFor="doc-upload-library">Document File (.txt, .pdf, .png, .jpg, etc.)</Label>
            <Input 
              key={fileInputKey} 
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

      <Card className="border-destructive">
        <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-5 w-5" /> Important: Local Helper Service Required</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
            <p className="font-semibold">
                To save uploaded documents, you MUST have the **local helper service running on your computer.** 
                This is a separate small server program (e.g., the Node.js `server.js` script) that MangaTalk sends files to.
            </p>
            <p className="text-muted-foreground">
                If you see errors like &quot;Failed to connect,&quot; &quot;fetch failed,&quot; or &quot;Local Save Failed,&quot; it almost always means this local helper service is **NOT RUNNING** or is blocked (e.g., by a firewall).
            </p>
             <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>Ensure your local helper service is started (e.g., run `node server.js` in its directory).</li>
                <li>Verify it's listening on `http://localhost:3001/upload`.</li>
                <li>Check your computer's firewall settings to ensure connections to port 3001 are allowed.</li>
            </ul>
            <p className="text-muted-foreground">
                MangaTalk itself **does not display a list** of files stored by your local helper service. To manage or view these documents, please access them directly from the folder on your local file system where your helper service saves them.
            </p>
            <p className="text-muted-foreground">
                For reading documents within this application, please use the &quot;Read2&quot; page to upload them for your current session. These session files are also sent to your local helper service for persistent storage (if it's running).
            </p>
        </CardContent>
      </Card>

    </div>
  );
}
