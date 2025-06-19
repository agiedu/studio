
// src/lib/localFileService.ts
'use server';

const LOCAL_SERVER_URL = "http://localhost:3001/upload";
const FETCH_TIMEOUT_MS = 15000; // 15 seconds

interface UploadResponse {
  status: string;
  path?: string;
  message?: string;
}

export async function uploadFileToLocalServer(
  data: FormData
): Promise<{ success: boolean; message: string; filePath?: string }> {
  // Top-level try-catch to ensure we always return a structured response
  try {
    const file = data.get('file') as File | null;

    if (!file) {
      console.error('[localFileService] No file found in FormData.');
      return { success: false, message: "No file received by the server. Ensure the 'file' key is used in FormData." };
    }

    // This FormData is for the fetch request to the local helper service
    const formDataForFetch = new FormData();
    formDataForFetch.append("file", file); 

    console.log('[localFileService] Attempting to upload file:', file.name, 'to', LOCAL_SERVER_URL);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(`[localFileService] Aborting fetch request to ${LOCAL_SERVER_URL} due to timeout (${FETCH_TIMEOUT_MS}ms).`);
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(LOCAL_SERVER_URL, {
        method: "POST",
        body: formDataForFetch,
        signal: controller.signal,
      });
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      let userMessage = `Failed to connect to the local file saving service at ${LOCAL_SERVER_URL}.`;
      if (fetchError.name === 'AbortError') {
        userMessage = `Request to the local file saving service timed out after ${FETCH_TIMEOUT_MS / 1000} seconds. Please ensure it is running and responsive.`;
      } else if (fetchError.message && typeof fetchError.message === 'string') {
        const errMsgLower = fetchError.message.toLowerCase();
        if (errMsgLower.includes('econnrefused')) {
          userMessage = `Connection was REFUSED by the local file saving service at ${LOCAL_SERVER_URL}. Please ensure it's running and not blocked by a firewall. Details: ${fetchError.message}`;
        } else if (errMsgLower.includes('fetch failed')) {
          userMessage = `The request to the local file saving service at ${LOCAL_SERVER_URL} FAILED entirely. This usually means the service is **NOT RUNNING** or is unreachable from the application's server environment. Please **START your local helper service** and try again. Details: ${fetchError.message}`;
        } else {
          userMessage += ` Please ensure it is running and accessible. Details: ${fetchError.message.substring(0,100)}`;
        }
      } else {
        userMessage += ` An unknown network error occurred. Please ensure the local service is running and accessible.`;
      }
      console.error('[localFileService] Fetch error:', fetchError);
      return { success: false, message: userMessage };
    }

    clearTimeout(timeoutId);

    console.log('[localFileService] Received response status:', response.status, response.statusText);

    const responseText = await response.text();
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
          if (responseText.trim().toLowerCase().startsWith("<html>") || responseText.trim().toLowerCase().startsWith("<!doctype html>")) {
            errorMessage += `\nLocal server returned an HTML page (possibly an error page), not the expected JSON. Ensure your local helper service is correctly configured.`;
          } else if (responseText.trim() === "") {
             errorMessage += `\nLocal server returned an empty response. Check your local helper service logs.`;
          }else {
            errorMessage += `\nRaw response snippet: ${responseText.substring(0, 150)}${responseText.length > 150 ? '...' : ''}`;
          }
        }
      }
      console.error('[localFileService] Upload failed (response not ok):', errorMessage);
      return { success: false, message: errorMessage };
    }
    
    if (!responseText && response.ok) {
      const emptyResponseMessage = "Local server returned a successful status but an empty/invalid response body. Cannot confirm save. Please check the local helper service's implementation to ensure it sends a JSON response like {'status': 'ok', 'path': '...'}.";
      console.warn('[localFileService]', emptyResponseMessage);
      return { success: false, message: emptyResponseMessage };
    }

    try {
      const result: UploadResponse = JSON.parse(responseText);
      console.log('[localFileService] Parsed successful response from local server:', result);

      if (result.status === "ok" && result.path) {
        return { success: true, message: `File saved locally at: ${result.path}`, filePath: result.path };
      } else {
        const issueMessage = result.message || "Local server indicated an issue with saving the file (but returned 2xx status). Ensure your local helper service sends a JSON response with {'status': 'ok', 'path': '...'}.";
        console.warn('[localFileService] Issue in successful response:', issueMessage);
        return { success: false, message: issueMessage };
      }
    } catch (error: any) {
      const parseErrorMessage = `Local server returned a 2xx status, but the response was not valid JSON. This may indicate an issue with the local helper service's response format. Ensure it sends a JSON response. Response snippet: ${responseText.substring(0, 150)}${responseText.length > 150 ? '...' : ''}`;
      console.error("[localFileService] Error parsing successful JSON response from local server:", error, "Raw text snippet:", responseText.substring(0,150));
      return { success: false, message: parseErrorMessage };
    }

  } catch (error: any) { 
    console.error("[localFileService] CRITICAL UNHANDLED ERROR in uploadFileToLocalServer:", error);
    let connectMessage = "A critical error occurred within the MangaTalk application while trying to process your file for local saving.";

    if (error instanceof TypeError && typeof error.message === 'string' && error.message.toLowerCase().includes('invalid response')) {
         connectMessage = `The MangaTalk application received an invalid or malformed response from an internal step. This is an application-side issue.`;
    } else if (error.message && typeof error.message === 'string') {
        connectMessage += ` Details: ${error.message.substring(0,150)}${error.message.length > 150 ? '...' : ''}`;
    } else {
        connectMessage += " An unknown internal error occurred.";
    }
    return { success: false, message: connectMessage };
  }
}
