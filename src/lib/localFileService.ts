
// src/lib/localFileService.ts
'use server';

const LOCAL_SERVER_URL = "http://localhost:3001/upload";
const FETCH_TIMEOUT_MS = 15000; // 15 seconds

export async function uploadFileToLocalServer(
  clientFormData: FormData
): Promise<{ success: boolean; message: string; filePath?: string }> {
  try {
    const file = clientFormData.get('file') as File | null;

    if (!file) {
      console.error('[localFileService] No file found in client FormData.');
      return { success: false, message: "No file received by the MangaTalk server. Ensure the 'file' key is used in FormData sent from the client." };
    }

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
      
      // More detailed server-side logging for the raw fetchError object
      console.error(`[localFileService] Raw Fetch Error. Name: ${fetchError.name}, Message: ${fetchError.message}, Cause: ${JSON.stringify(fetchError.cause)}, Stack: ${fetchError.stack}`);

      if (fetchError.name === 'AbortError') {
        userMessage = `Request to the local file saving service timed out after ${FETCH_TIMEOUT_MS / 1000} seconds. Please ensure it is running and responsive.`;
      } else if (fetchError.cause && typeof fetchError.cause === 'object' && 'code' in fetchError.cause) {
        const errorCode = (fetchError.cause as { code: string }).code;
        if (errorCode === 'ECONNREFUSED') {
          userMessage = `Connection was REFUSED by the local file saving service at ${LOCAL_SERVER_URL}. This means the MangaTalk application tried to connect, but your local computer actively rejected it. **This is almost certainly because your local helper service (e.g., 'server.js') is NOT RUNNING, or a firewall is blocking port ${new URL(LOCAL_SERVER_URL).port}. Please START your local helper service and check your firewall.**`;
          console.error(`[localFileService] ECONNREFUSED: Ensure the local helper service is running at ${LOCAL_SERVER_URL} and port ${new URL(LOCAL_SERVER_URL).port} is not blocked by a firewall.`);
        } else if (errorCode === 'ENOTFOUND' || errorCode === 'EAI_AGAIN') {
          userMessage = `Could not resolve the address for the local file saving service (${LOCAL_SERVER_URL}). Check your network or if the hostname is correct.`;
        } else {
          userMessage += ` Please ensure it is **RUNNING** and accessible. Network error details: ${errorCode} ${fetchError.message ? `- ${fetchError.message.substring(0,100)}` : ''}`;
        }
      } else if (fetchError.message && typeof fetchError.message === 'string' && fetchError.message.toLowerCase().includes('fetch failed')) {
         userMessage = `The request to the local file saving service at ${LOCAL_SERVER_URL} FAILED entirely. This usually means the service is **NOT RUNNING** or is unreachable from the application's server environment. Please **START your local helper service** and try again. Details: ${fetchError.message}`;
      } else {
        userMessage += ` An unknown network error occurred. Please ensure the local service is running and accessible. Details: ${fetchError.message ? fetchError.message.substring(0,100) : 'No specific message'}`;
      }
      console.error('[localFileService] Fetch error summary:', userMessage);
      return { success: false, message: userMessage };
    }

    clearTimeout(timeoutId);

    const responseText = await response.text();

    if (!response.ok) {
      let errorMessage = `Local server request failed. Status: ${response.status} ${response.statusText || ''}`.trim();
      if (responseText) {
        try {
          const errorResult = JSON.parse(responseText);
          errorMessage = errorResult.message || `Local server error: ${responseText.substring(0,150)}`;
        } catch (parseError) {
          if (responseText.trim().toLowerCase().startsWith("<html>") || responseText.trim().toLowerCase().startsWith("<!doctype html>")) {
            errorMessage += `\nLocal server returned an HTML page (possibly an error page), not the expected JSON. Ensure your local helper service is correctly configured.`;
          } else if (responseText.trim() === "") {
             errorMessage += `\nLocal server returned an empty response. Check your local helper service logs.`;
          }else {
            errorMessage += `\nRaw response snippet: ${responseText.substring(0, 150)}${responseText.length > 150 ? '...' : ''}`;
          }
        }
      }
      console.error('[localFileService] Upload failed (response not ok):', errorMessage, 'Raw response text:', responseText.substring(0,300));
      return { success: false, message: errorMessage };
    }
    
    if (!responseText && response.ok) {
      const emptyResponseMessage = "Local server returned a successful status but an empty/invalid response body. Cannot confirm save. Please check the local helper service's implementation to ensure it sends a JSON response like {'status': 'ok', 'path': '...'}.";
      console.warn('[localFileService]', emptyResponseMessage);
      return { success: false, message: emptyResponseMessage };
    }

    try {
      const result = JSON.parse(responseText);
      if (result.status === "ok" && result.path) {
        return { success: true, message: `File saved locally at: ${result.path}`, filePath: result.path };
      } else {
        const issueMessage = result.message || "Local server indicated an issue with saving the file (but returned 2xx status). Ensure your local helper service sends a JSON response with {'status': 'ok', 'path': '...'}.";
        console.warn('[localFileService] Issue in successful response:', issueMessage, 'Parsed response:', result);
        return { success: false, message: issueMessage };
      }
    } catch (error: any) {
      const parseErrorMessage = `Local server returned a 2xx status, but the response was not valid JSON. This may indicate an issue with the local helper service's response format. Ensure it sends a JSON response. Response snippet: ${responseText.substring(0, 150)}${responseText.length > 150 ? '...' : ''}`;
      console.error("[localFileService] Error parsing successful JSON response from local server:", error, "Raw text snippet:", responseText.substring(0,150));
      return { success: false, message: parseErrorMessage };
    }

  } catch (criticalError: any) { 
    console.error("[localFileService] CRITICAL UNHANDLED ERROR in uploadFileToLocalServer:", JSON.stringify(criticalError, Object.getOwnPropertyNames(criticalError)));
    let connectMessage = "A critical error occurred within the MangaTalk application while trying to process your file for local saving.";

    if (criticalError instanceof TypeError && typeof criticalError.message === 'string' && criticalError.message.toLowerCase().includes('invalid response')) {
         connectMessage = `The MangaTalk application received an invalid or malformed response from an internal step. This is an application-side issue.`;
    } else if (criticalError.message && typeof criticalError.message === 'string') {
        connectMessage += ` Details: ${criticalError.message.substring(0,150)}${criticalError.message.length > 150 ? '...' : ''}`;
    } else {
        connectMessage += " An unknown internal error occurred.";
    }
    return { success: false, message: connectMessage };
  }
}
