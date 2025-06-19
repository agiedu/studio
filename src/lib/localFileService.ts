
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
      console.error('[localFileService] No file found in client FormData. Ensure "file" key is used.');
      return { success: false, message: "Server Action Error: No file data received from client. Ensure the 'file' key is used in FormData." };
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
      
      console.error(
        `[localFileService] Raw Fetch Error to ${LOCAL_SERVER_URL}. Name: ${fetchError.name}, Message: ${fetchError.message}, Cause: ${JSON.stringify(fetchError.cause)}, Stack (partial): ${fetchError.stack?.substring(0, 500)}`
      );

      if (fetchError.name === 'AbortError') {
        userMessage = `Request to the local file saving service timed out after ${FETCH_TIMEOUT_MS / 1000} seconds. Please ensure it is **RUNNING** and responsive. **Check its console output for errors and verify it's not overwhelmed or stuck.**`;
      } else if (fetchError.cause && typeof fetchError.cause === 'object' && 'code' in fetchError.cause) {
        const errorCode = (fetchError.cause as { code: string }).code;
        if (errorCode === 'ECONNREFUSED') {
          userMessage = `CRITICAL: Connection was REFUSED by the local file saving service at ${LOCAL_SERVER_URL}. This means your computer actively rejected the connection. **This almost certainly means your local helper service (e.g., 'server.js') is NOT RUNNING, or a firewall is blocking port ${new URL(LOCAL_SERVER_URL).port}. Please START your local helper service, check its console output to ensure it's listening on the correct port, and then try again. Also, verify firewall settings.**`;
          console.error(`[localFileService] ECONNREFUSED: Ensure the local helper service is running at ${LOCAL_SERVER_URL}, listening on port ${new URL(LOCAL_SERVER_URL).port}, and is not blocked by a firewall. Check the helper service's console for errors.`);
        } else if (errorCode === 'ENOTFOUND' || errorCode === 'EAI_AGAIN') {
          userMessage = `Could not resolve the address for the local file saving service (${LOCAL_SERVER_URL}). This is a DNS or network configuration issue. Check your network settings or if the hostname and port are correct.`;
        } else {
          userMessage += ` Please ensure your local helper service is **RUNNING** and accessible. Network error details: ${errorCode} ${fetchError.message ? `- ${fetchError.message.substring(0,100)}` : ''}`;
        }
      } else if (fetchError.message && typeof fetchError.message === 'string' && fetchError.message.toLowerCase().includes('fetch failed')) {
         userMessage = `The request to the local file saving service at ${LOCAL_SERVER_URL} FAILED entirely (fetch failed). This usually means the service is **NOT RUNNING** or is unreachable from the application's server environment. **CRITICAL: Please START your local helper service (e.g., 'server.js'), check its console output for errors, and try again. Also, verify firewall settings.** Details: ${fetchError.message}`;
      } else {
        userMessage += ` An unknown network error occurred. Please ensure the local service is **RUNNING** and accessible. Details: ${fetchError.message ? fetchError.message.substring(0,100) : 'No specific message'}`;
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
            errorMessage += `\nLocal server returned an HTML page (possibly an error page), not the expected JSON. Ensure your local helper service is correctly configured and running, and sends JSON responses. Check its console output.`;
          } else if (responseText.trim() === "") {
             errorMessage += `\nLocal server returned an empty response (but status was not OK: ${response.status}). Check your local helper service logs and ensure it sends a JSON response with an error message.`;
          }else {
            errorMessage += `\nRaw response snippet: ${responseText.substring(0, 150)}${responseText.length > 150 ? '...' : ''}. Check your local helper service.`;
          }
        }
      }
      console.error('[localFileService] Upload failed (response not ok):', errorMessage, 'Raw response text:', responseText.substring(0,300));
      return { success: false, message: errorMessage };
    }
    
    if (!responseText && response.ok) {
      const emptyResponseMessage = "Local server returned a successful status (2xx) but an empty/invalid response body. Cannot confirm save. **Please check the local helper service's implementation to ensure it sends a JSON response like {'status': 'ok', 'path': '...'}. Check its console output.**";
      console.warn('[localFileService]', emptyResponseMessage);
      return { success: false, message: emptyResponseMessage };
    }

    try {
      const result = JSON.parse(responseText);
      if (result.status === "ok" && result.path) {
        return { success: true, message: `File saved locally at: ${result.path}`, filePath: result.path };
      } else {
        const issueMessage = result.message || "Local server indicated an issue with saving the file (but returned 2xx status). **Ensure your local helper service sends a JSON response with {'status': 'ok', 'path': '...'}. Check its console output.**";
        console.warn('[localFileService] Issue in successful response:', issueMessage, 'Parsed response:', result);
        return { success: false, message: issueMessage };
      }
    } catch (error: any) {
      const parseErrorMessage = `Local server returned a 2xx status, but the response was not valid JSON. This may indicate an issue with the local helper service's response format. **Ensure it sends a JSON response. Check its console output.** Response snippet: ${responseText.substring(0, 150)}${responseText.length > 150 ? '...' : ''}`;
      console.error("[localFileService] Error parsing successful JSON response from local server:", error, "Raw text snippet:", responseText.substring(0,150));
      return { success: false, message: parseErrorMessage };
    }

  } catch (criticalError: any) { 
    let errorMessage = "An unexpected critical error occurred in the server-side file processing logic.";
    if (criticalError instanceof Error) {
      errorMessage = `Server Action Critical Error: ${criticalError.name} - ${criticalError.message}`;
    } else if (typeof criticalError === 'string') {
      errorMessage = `Server Action Critical Error: ${criticalError}`;
    } else {
      errorMessage = `Server Action Critical Error: An unknown error object was caught. Details: ${String(criticalError).substring(0, 200)}`;
    }
    
    // Detailed server-side logging
    console.error(
      `[localFileService] CRITICAL UNHANDLED ERROR in uploadFileToLocalServer. Type: ${criticalError?.constructor?.name}. Message: ${criticalError?.message || 'N/A'}. Stack: ${criticalError?.stack || 'N/A'}. Cause: ${criticalError?.cause ? JSON.stringify(criticalError.cause) : 'N/A'}. Full Error Object:`, criticalError
    );
    
    // Return a clean, truncated message to the client
    return { success: false, message: errorMessage.substring(0, 500) };
  }
}

