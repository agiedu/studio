
// src/lib/localFileService.ts
'use server';

const LOCAL_SERVER_URL = "http://localhost:3001/upload";

interface UploadResponse {
  status: string;
  path?: string;
  message?: string;
}

export async function uploadFileToLocalServer(file: File): Promise<{ success: boolean; message: string; filePath?: string }> {
  // Top-level try-catch to ensure we always return a structured response
  try {
    const formData = new FormData();
    formData.append("file", file);
    console.log('[localFileService] Attempting to upload file:', file.name, 'to', LOCAL_SERVER_URL);

    const response = await fetch(LOCAL_SERVER_URL, {
      method: "POST",
      body: formData,
    });
    console.log('[localFileService] Received response status:', response.status, response.statusText);

    const responseText = await response.text(); // Get raw text first
    // Log only a snippet of response text to avoid flooding logs with large HTML error pages
    console.log('[localFileService] Received response text (first 300 chars):', responseText.substring(0,300));


    if (!response.ok) {
      let errorMessage = `Local server request failed. Status: ${response.status} ${response.statusText || ''}`.trim();
      if (responseText) {
        try {
          const errorResult: UploadResponse = JSON.parse(responseText);
          errorMessage = errorResult.message || `Local server error: ${responseText.substring(0,150)}`;
          console.log('[localFileService] Parsed error response from local server:', errorResult);
        } catch (parseError) {
          console.warn("[localFileService] Local server error response was not JSON. Status:", response.status, parseError);
          // Provide a more user-friendly part of the raw response if it looks like HTML.
          if (responseText.trim().toLowerCase().startsWith("<html>") || responseText.trim().toLowerCase().startsWith("<!doctype html>")) {
            errorMessage += `\nLocal server returned an HTML page (possibly an error page).`;
          } else {
            errorMessage += `\nRaw response snippet: ${responseText.substring(0, 150)}${responseText.length > 150 ? '...' : ''}`;
          }
        }
      }
      console.error('[localFileService] Upload failed (response not ok):', errorMessage);
      return { success: false, message: errorMessage };
    }

    // If response.ok is true
    if (!responseText) {
      const emptyResponseMessage = "Local server returned a successful status but an empty response body.";
      console.warn('[localFileService]', emptyResponseMessage);
      return { success: false, message: emptyResponseMessage };
    }

    try {
      const result: UploadResponse = JSON.parse(responseText);
      console.log('[localFileService] Parsed successful response from local server:', result);

      if (result.status === "ok" && result.path) {
        return { success: true, message: `File saved locally at: ${result.path}`, filePath: result.path };
      } else {
        const issueMessage = result.message || "Local server indicated an issue with saving the file (but returned 2xx status).";
        console.warn('[localFileService] Issue in successful response:', issueMessage);
        return { success: false, message: issueMessage };
      }
    } catch (error: any) {
      const parseErrorMessage = `Local server returned a 2xx status, but the response was not valid JSON. Response snippet: ${responseText.substring(0, 150)}${responseText.length > 150 ? '...' : ''}`;
      console.error("[localFileService] Error parsing successful JSON response from local server:", error, "Raw text snippet:", responseText.substring(0,150));
      return { success: false, message: parseErrorMessage };
    }

  } catch (error: any) { // This is the outer catch for any error within this Server Action
    console.error("[localFileService] CRITICAL UNHANDLED ERROR in uploadFileToLocalServer:", error);
    let connectMessage = "A critical error occurred while trying to communicate with the local file saving service.";

    if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) {
         connectMessage = "Connection to the local file saving service failed (network error). Please ensure it's running at http://localhost:3001 and that there are no CORS issues if your local server is configured to require them.";
    } else if (error.message) {
        connectMessage += ` Details: ${error.message.substring(0,150)}${error.message.length > 150 ? '...' : ''}`;
    } else {
        connectMessage += " An unknown internal error or network issue occurred.";
    }
    return { success: false, message: connectMessage };
  }
}
