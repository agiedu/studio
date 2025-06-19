
// src/lib/localFileService.ts
'use server';

const LOCAL_SERVER_URL = "http://localhost:3001/upload";
const FETCH_TIMEOUT_MS = 15000; // 15 seconds

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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(`[localFileService] Aborting fetch request to ${LOCAL_SERVER_URL} due to timeout (${FETCH_TIMEOUT_MS}ms).`);
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(LOCAL_SERVER_URL, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
    } catch (fetchError: any) {
      clearTimeout(timeoutId); // Clear timeout if fetch itself throws an error (e.g. network error before timeout)
      if (fetchError.name === 'AbortError') {
        console.error('[localFileService] Request to local server timed out.');
        return { success: false, message: `Request to the local file saving service timed out after ${FETCH_TIMEOUT_MS / 1000} seconds. Please ensure it is running and responsive.` };
      }
      // Handle other fetch errors (e.g., ECONNREFUSED if server is down)
      console.error('[localFileService] Fetch error when trying to connect to local server:', fetchError.message);
      let userMessage = 'Failed to connect to the local file saving service.';
      if (fetchError.message && fetchError.message.toLowerCase().includes('econnrefused')) {
        userMessage = `Connection refused by the local file saving service at ${LOCAL_SERVER_URL}. Please ensure it's running.`;
      } else if (fetchError.message) {
        userMessage += ` Details: ${fetchError.message}`;
      }
      return { success: false, message: userMessage };
    }

    clearTimeout(timeoutId); // Clear timeout if fetch completes or errors before timeout

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
            errorMessage += `\nLocal server returned an HTML page (possibly an error page).`;
          } else {
            errorMessage += `\nRaw response snippet: ${responseText.substring(0, 150)}${responseText.length > 150 ? '...' : ''}`;
          }
        }
      }
      console.error('[localFileService] Upload failed (response not ok):', errorMessage);
      return { success: false, message: errorMessage };
    }

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

  } catch (error: any) {
    console.error("[localFileService] CRITICAL UNHANDLED ERROR in uploadFileToLocalServer:", error);
    let connectMessage = "A critical error occurred while trying to communicate with the local file saving service.";

    if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) {
         connectMessage = `Connection to the local file saving service failed (network error). Please ensure it's running at ${LOCAL_SERVER_URL} and that there are no CORS issues if your local server is configured to require them.`;
    } else if (error.message) {
        connectMessage += ` Details: ${error.message.substring(0,150)}${error.message.length > 150 ? '...' : ''}`;
    } else {
        connectMessage += " An unknown internal error or network issue occurred.";
    }
    return { success: false, message: connectMessage };
  }
}
