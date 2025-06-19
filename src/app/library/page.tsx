
"use client";

import { useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { UploadCloud, AlertTriangle, Info } from 'lucide-react';
import { uploadFileToLocalServer } from '@/lib/localFileService'; 
import { Button } from '@/components/ui/button'; // Added for potential reset button

export default function LibraryPage() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(Date.now()); // Used to reset file input
  const fileInputRef = useRef<HTMLInputElement>(null);


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
        // Reset file input so the same file can be selected again if needed
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        setFileInputKey(Date.now()); // Or use this method if preferred
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Send Document to Your Local Device</CardTitle>
          <CardDescription>
            Use this page to send TXT, PDF, or Image files to your **local helper service**.
            This application **does not store these documents in the browser**. All uploaded files are sent directly to the helper service running on your computer.
            The MangaTalk application **does not display a list** of files stored by your local helper service.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid w-full max-w-md items-center gap-1.5">
            <Label htmlFor="doc-upload-library">Document File (.txt, .pdf, .png, .jpg, etc.)</Label>
            <Input 
              key={fileInputKey}
              ref={fileInputRef}
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
            <CardTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-5 w-5" /> CRITICAL: Local Helper Service Required!</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
            <p className="font-semibold text-base">
                To save uploaded documents, you **MUST** have the **local helper service running on your computer.** 
                This is a separate small server program (e.g., a Node.js `server.js` script) that MangaTalk attempts to send files to.
            </p>
            <p className="text-destructive-foreground font-medium">
                If you see errors like &quot;Failed to connect,&quot; &quot;fetch failed,&quot; &quot;Connection Refused,&quot; or &quot;Local Save Failed,&quot; it almost certainly means this local helper service is **NOT RUNNING**, is blocked by a firewall, or is not accessible on `http://localhost:3001/upload`.
            </p>
             <p className="font-semibold mt-2">Troubleshooting Steps:</p>
             <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>**1. START THE HELPER SERVICE:** Open a terminal/command prompt, navigate to the directory containing your helper service script (e.g., `server.js`), and run it (e.g., `node server.js`).</li>
                <li>**2. CHECK ITS CONSOLE:** Look at the terminal output of your helper service. It should indicate that it's running and listening on port 3001 (or similar). Check for any error messages there.</li>
                <li>**3. VERIFY URL & PORT:** Confirm your helper service is configured to listen for uploads at `http://localhost:3001/upload`.</li>
                <li>**4. CHECK FIREWALL:** Ensure your computer's firewall is not blocking incoming connections to port 3001 for the helper service application.</li>
                <li>**5. TRY AGAIN:** After verifying the above, try uploading a file again.</li>
            </ul>
            <p className="text-muted-foreground mt-3">
                MangaTalk itself **does not display a list** of files stored by your local helper service. To manage or view these documents, please access them directly from the folder on your local file system where your helper service saves them.
            </p>
            <p className="text-muted-foreground">
                For reading documents within this application during your current session, please use the &quot;Read2&quot; page to upload them. These session files are also attempted to be sent to your local helper service for persistent storage (if it's running and accessible).
            </p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-2"><Info className="h-5 w-5" /> Manual Local Saving (Workaround)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
                If your local helper service is unavailable or you prefer a different method, you can manually save content displayed in the MangaTalk application using your browser's built-in features:
            </p>
             <ul className="list-disc pl-5 space-y-1">
                <li>**Save Page As:** For web pages or rendered content, you can often right-click and select "Save Page As..." or use your browser's menu (File &gt; Save Page As...). This might save an HTML file and associated resources.</li>
                <li>**Print to PDF:** Most browsers allow you to "Print" a page and choose "Save as PDF" as the destination. This is useful for text content or static views.</li>
                <li>**Screenshots:** For visual content, taking screenshots is always an option.</li>
            </ul>
            <p className="font-medium mt-2">
                Note: These manual methods are workarounds and do not involve the MangaTalk application's designed local saving feature, which relies on the helper service.
            </p>
        </CardContent>
      </Card>

    </div>
  );
}
