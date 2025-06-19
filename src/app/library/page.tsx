
"use client";

import { useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { UploadCloud, AlertTriangle, Info, ServerCrash } from 'lucide-react';
import { uploadFileToLocalServer } from '@/lib/localFileService';

export default function LibraryPage() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);


  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const localUploadResult = await uploadFileToLocalServer(formData);

      if (localUploadResult && localUploadResult.success && localUploadResult.filePath) {
        toast({ title: "File Sent to Local Device", description: `${file.name} sent successfully. Path: ${localUploadResult.filePath}` });
      } else {
        let description = "Could not save to local device. Ensure the helper service is running and check its console.";
        if (localUploadResult && typeof localUploadResult === 'object' && Object.keys(localUploadResult).length === 0) {
          description = "Upload failed: The application received an empty response from the server. This indicates an unexpected server-side issue. Please check the Next.js server console and your local helper service logs for detailed errors.";
        } else if (localUploadResult && localUploadResult.message) {
          description = localUploadResult.message;
        }
        toast({ variant: "destructive", title: "Local Save Failed", description });
        console.error("[LibraryPage] Local save failed client-side. Server Action Response:", localUploadResult);
      }

    } catch (error: any) {
      const errorMessage = error.message || "An unknown error occurred while trying to initiate the file send operation.";
      toast({ variant: "destructive", title: "Upload Initiation Error", description: errorMessage });
      console.error("[LibraryPage] Error calling uploadFileToLocalServer action:", error);
    } finally {
        setIsLoading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        setFileInputKey(Date.now());
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UploadCloud className="text-primary" /> Send Document to Your Local Device</CardTitle>
          <CardDescription>
            Use this page to send TXT, PDF, or Image files to your **local helper service** running on your computer.
            This MangaTalk web application **does not store these documents in the browser, nor does it display a list** of files already stored by your local helper service.
            All uploaded files are sent directly to the helper service for persistent storage.
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
          {isLoading && <p className="mt-2 text-sm text-muted-foreground">Sending file to local helper service...</p>}
        </CardContent>
      </Card>

      <Card className="border-destructive bg-destructive/5">
        <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive-foreground"><ServerCrash className="h-6 w-6" /> CRITICAL: Local Helper Service Required!</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-destructive-foreground/90">
            <p className="font-semibold text-base">
                To persistently save uploaded documents and enable reading, you **MUST** have the **local helper service running on your computer.**
                This is a separate small server program (e.g., a Node.js `server.js` script) that MangaTalk sends files to.
            </p>
            <p className="font-medium">
                If you see errors like <span className="font-bold">&quot;Failed to connect,&quot;</span> <span className="font-bold">&quot;fetch failed,&quot;</span> <span className="font-bold">&quot;Connection Refused,&quot;</span> or <span className="font-bold">&quot;Local Save Failed,&quot;</span> it almost certainly means this local helper service is **NOT RUNNING**, is blocked by a firewall, or is not accessible at `http://localhost:3001/upload`.
            </p>
             <p className="font-semibold mt-3">Troubleshooting Steps:</p>
             <ol className="list-decimal pl-5 space-y-1.5">
                <li><strong>START THE HELPER SERVICE:</strong> Open a terminal/command prompt, navigate to the directory containing your helper service script (e.g., `server.js`), and run it (e.g., <code className="bg-destructive/20 px-1 py-0.5 rounded">node server.js</code>).</li>
                <li><strong>CHECK ITS CONSOLE OUTPUT:</strong> Look at the terminal output of your helper service. It should clearly indicate that it's running and listening on port 3001 (or similar). **Check for any error messages there.** This is the most important step for debugging.</li>
                <li><strong>VERIFY URL & PORT:</strong> Confirm your helper service is configured to listen for uploads at `http://localhost:3001/upload` and sends back JSON responses.</li>
                <li><strong>FIREWALL:</strong> Ensure your computer's firewall is not blocking incoming connections to port 3001 for the helper service application (Node.js, Python, etc.).</li>
                <li><strong>RETRY UPLOAD:</strong> After verifying the above, try uploading a file again from MangaTalk.</li>
                <li><strong>CHECK NEXT.JS SERVER CONSOLE:</strong> Also check the console where you run MangaTalk (`npm run dev`) for detailed error messages from the Server Action.</li>
            </ol>
            <p className="mt-3">
                MangaTalk **does not display a list** of files stored by your local helper service. To manage or view these documents, please access them directly from the folder on your local file system where your helper service saves them.
            </p>
            <p>
                For reading documents within this application during your current session, please use the &quot;Read2&quot; page to upload them. Uploaded files there are also attempted to be sent to your local helper service for persistent storage. If the local service is not running, these files will be lost on refresh.
            </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-2"><Info className="h-5 w-5" /> Manual Local Saving (Workaround)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
                If your local helper service is unavailable or you prefer a different method for quick, temporary saves of content displayed in MangaTalk, you can use your browser's built-in features:
            </p>
             <ul className="list-disc pl-5 space-y-1">
                <li><strong>Save Page As:</strong> For web pages or rendered content, right-click and select "Save Page As..." or use your browser's menu (File &gt; Save Page As...).</li>
                <li><strong>Print to PDF:</strong> Most browsers allow you to "Print" a page and choose "Save as PDF" as the destination.</li>
                <li><strong>Screenshots:</strong> For visual content, taking screenshots is always an option.</li>
            </ul>
            <p className="font-medium mt-2">
                Note: These manual methods are workarounds and do not involve MangaTalk's designed local saving feature, which relies on an **operational local helper service.**
            </p>
        </CardContent>
      </Card>

    </div>
  );
}
