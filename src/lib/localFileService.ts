
// src/lib/localFileService.ts
'use server';

const LOCAL_SERVER_URL = "http://localhost:3001/upload";
const FETCH_TIMEOUT_MS = 10000; // 10 seconds timeout

export async function uploadFileToLocalServer(
  clientFormData: FormData
): Promise<{ success: boolean; message: string; filePath?: string }> {
  console.log('[localFileService] Server Action: Invoked.');

  if (!clientFormData || typeof clientFormData.get !== 'function') {
    const errorMsg = "Server Action Critical Error: Invalid or no FormData received from client.";
    console.error(`[localFileService] ${errorMsg} Received type: ${typeof clientFormData}, Received value:`, clientFormData);
    console.log(`[localFileService] Server Action: Attempting to return failure (invalid FormData): { success: false, message: "${errorMsg}" }`);
    return { success: false, message: errorMsg };
  }

  try {
    const file = clientFormData.get('file') as File | null;

    if (!file) {
      const errorMsg = "Server Action Error: No file data found in FormData. Ensure the 'file' key is used.";
      console.error('[localFileService] Error:', errorMsg);
      console.log(`[localFileService] Server Action: Attempting to return failure (no file): { success: false, message: "${errorMsg}" }`);
      return { success: false, message: errorMsg };
    }

    const formDataForFetch = new FormData();
    formDataForFetch.append("file", file);

    console.log(`[localFileService] Attempting to upload file: "${file.name}" (size: ${file.size} bytes, type: ${file.type}) to ${LOCAL_SERVER_URL}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(`[localFileService] Aborting fetch request to ${LOCAL_SERVER_URL} for file "${file.name}" due to timeout (${FETCH_TIMEOUT_MS}ms).`);
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
        `[localFileService] RAW FETCH ERROR to ${LOCAL_SERVER_URL} for file "${file.name}". Name: ${fetchError.name}, Message: ${fetchError.message}, Cause: ${JSON.stringify(fetchError.cause)}, Stack (partial): ${fetchError.stack?.substring(0, 500)}`
      );

      if (fetchError.name === 'AbortError') {
        userMessage = `Request to the local file saving service for "${file.name}" timed out after ${FETCH_TIMEOUT_MS / 1000} seconds. Please ensure it is **RUNNING**, responsive, and not overwhelmed. **Check its console output for errors.**`;
      } else if (fetchError.cause && typeof fetchError.cause === 'object' && 'code' in fetchError.cause) {
        const errorCode = (fetchError.cause as { code: string }).code;
        if (errorCode === 'ECONNREFUSED') {
          userMessage = `CRITICAL: Connection was REFUSED by the local file saving service at ${LOCAL_SERVER_URL} for file "${file.name}". Your computer actively rejected the connection. **This almost certainly means your local helper service (e.g., 'server.js') is NOT RUNNING, or a firewall is blocking port ${new URL(LOCAL_SERVER_URL).port}. Please START your local helper service, check its console output to ensure it's listening on the correct port, and then try again. Also, verify firewall settings.**`;
        } else if (errorCode === 'ENOTFOUND' || errorCode === 'EAI_AGAIN') {
          userMessage = `Could not resolve the address for the local file saving service (${LOCAL_SERVER_URL}) when trying to upload "${file.name}". This is a DNS or network configuration issue. Check your network settings or if the hostname and port are correct.`;
        } else {
          userMessage += ` Please ensure your local helper service is **RUNNING** and accessible. Network error details: ${errorCode} ${fetchError.message ? `- ${fetchError.message.substring(0,100)}` : ''}`;
        }
      } else if (fetchError.message && typeof fetchError.message === 'string' && fetchError.message.toLowerCase().includes('fetch failed')) {
         userMessage = `The request to the local file saving service at ${LOCAL_SERVER_URL} FAILED entirely (fetch failed) for file "${file.name}". This usually means the service is **NOT RUNNING** or is unreachable from the application's server environment. **CRITICAL: Please START your local helper service (e.g., 'server.js'), check its console output for errors, and try again. Also, verify firewall settings.** Details: ${fetchError.message}`;
      } else {
        userMessage += ` An unknown network error occurred when trying to upload "${file.name}". Please ensure the local service is **RUNNING** and accessible. Details: ${fetchError.message ? fetchError.message.substring(0,100) : 'No specific message'}`;
      }
      console.error('[localFileService] Fetch error summary:', userMessage);
      console.log(`[localFileService] Server Action: Attempting to return failure (fetch error for ${file.name}): { success: false, message: "${userMessage}" }`);
      return { success: false, message: userMessage };
    }

    clearTimeout(timeoutId);

    const responseText = await response.text();

    if (!response.ok) {
      let errorMessage = `Local server request failed for file "${file.name}". Status: ${response.status} ${response.statusText || ''}`.trim();
      if (responseText) {
        try {
          const errorResult = JSON.parse(responseText);
          errorMessage = errorResult.message || `Local server error (status ${response.status}): ${responseText.substring(0,150)}`;
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
      console.error('[localFileService] Upload failed (response not ok):', errorMessage, 'Raw response text for file', file.name, ':', responseText.substring(0,300));
      console.log(`[localFileService] Server Action: Attempting to return failure (response not ok for ${file.name}): { success: false, message: "${errorMessage}" }`);
      return { success: false, message: errorMessage };
    }

    if (!responseText && response.ok) {
      const emptyResponseMessage = `Local server returned a successful status (2xx) for file "${file.name}" but an empty/invalid response body. Cannot confirm save. **Please check the local helper service's implementation to ensure it sends a JSON response like {'status': 'ok', 'path': '...'}. Check its console output.**`;
      console.warn('[localFileService]', emptyResponseMessage);
      console.log(`[localFileService] Server Action: Attempting to return failure (empty/invalid successful response for ${file.name}): { success: false, message: "${emptyResponseMessage}" }`);
      return { success: false, message: emptyResponseMessage };
    }

    try {
      const result = JSON.parse(responseText);
      if (result.status === "ok" && result.path) {
        const successMsg = `File "${file.name}" saved locally by helper service at: ${result.path}`;
        console.log('[localFileService] Success:', successMsg);
        console.log(`[localFileService] Server Action: Attempting to return success for ${file.name}: { success: true, message: "${successMsg}", filePath: "${result.path}" }`);
        return { success: true, message: successMsg, filePath: result.path };
      } else {
        const issueMessage = result.message || `Local server indicated an issue with saving file "${file.name}" (but returned 2xx status). **Ensure your local helper service sends a JSON response with {'status': 'ok', 'path': '...'}. Check its console output.**`;
        console.warn('[localFileService] Issue in successful response:', issueMessage, 'Parsed response:', result);
        console.log(`[localFileService] Server Action: Attempting to return failure (issue in successful response for ${file.name}): { success: false, message: "${issueMessage}" }`);
        return { success: false, message: issueMessage };
      }
    } catch (error: any) {
      const parseErrorMessage = `Local server returned a 2xx status for file "${file.name}", but the response was not valid JSON. This may indicate an issue with the local helper service's response format. **Ensure it sends a JSON response. Check its console output.** Response snippet: ${responseText.substring(0, 150)}${responseText.length > 150 ? '...' : ''}`;
      console.error("[localFileService] Error parsing successful JSON response from local server:", error, "Raw text snippet for file", file.name, ":", responseText.substring(0,150));
      console.log(`[localFileService] Server Action: Attempting to return failure (JSON parse error for ${file.name}): { success: false, message: "${parseErrorMessage}" }`);
      return { success: false, message: parseErrorMessage };
    }

  } catch (criticalError: any) {
    let rawMessage = "Unknown critical error occurred in Server Action.";
    if (criticalError instanceof Error && criticalError.message) {
        rawMessage = criticalError.message;
    } else if (typeof criticalError === 'string') {
        rawMessage = criticalError;
    } else {
        try {
            rawMessage = JSON.stringify(criticalError);
        } catch (e) {
            // already "Unknown..." by default
        }
    }

    console.error(
      `[localFileService] SERVER ACTION CRITICAL UNHANDLED ERROR. Type: ${criticalError?.constructor?.name}. Message: ${rawMessage}. Stack: ${criticalError?.stack || 'N/A'}. Cause: ${criticalError?.cause ? JSON.stringify(criticalError.cause) : 'N/A'}. Full Error Object:`, criticalError
    );
    const userMessage = `Server Action Critical Error: ${String(rawMessage).substring(0, 250)}. Please check server logs.`;
    console.log(`[localFileService] Server Action: Attempting to return failure (critical unhandled error): { success: false, message: "${userMessage}" }`);
    return { success: false, message: userMessage };
  }
}
