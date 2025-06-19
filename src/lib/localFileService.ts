// src/lib/localFileService.ts
'use server';

const LOCAL_SERVER_URL = "http://localhost:3001/upload";

interface UploadResponse {
  status: string;
  path?: string;
  message?: string;
}

export async function uploadFileToLocalServer(file: File): Promise<{ success: boolean; message: string; filePath?: string }> {
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch(LOCAL_SERVER_URL, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      let errorMessage = `Failed to upload file to local server. Status: ${response.status}`;
      try {
        const errorResult: UploadResponse = await response.json();
        errorMessage = errorResult.message || errorMessage;
      } catch (e) {
        // Ignore if parsing error response fails
      }
      return { success: false, message: errorMessage };
    }

    const result: UploadResponse = await response.json();

    if (result.status === "ok" && result.path) {
      return { success: true, message: `File saved locally at: ${result.path}`, filePath: result.path };
    } else {
      return { success: false, message: result.message || "Local server reported an issue with saving the file." };
    }
  } catch (error: any) {
    console.error("Error uploading file to local server:", error);
    let connectMessage = "Could not connect to the local file saving service. Please ensure it is running on your device and try again.";
    if (error.message && error.message.includes('Failed to fetch')) {
         connectMessage = "Connection to the local file saving service failed. Please ensure it's running and accessible at http://localhost:3001.";
    }
    return { success: false, message: connectMessage };
  }
}
