
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
      let errorMessage = `Failed to upload file to local server. Status: ${response.status} ${response.statusText || ''}`.trim();
      try {
        const errorBody = await response.text(); // Get raw text first
        if (errorBody) {
            try {
                const errorResult: UploadResponse = JSON.parse(errorBody);
                errorMessage = errorResult.message || errorMessage;
            } catch (parseError) {
                // If not JSON, include part of the text body if it's not too long and seems like an error message
                if (errorBody.length < 500 && (errorBody.toLowerCase().includes('error') || response.status >= 500)) {
                     errorMessage += `\nServer response: ${errorBody.substring(0, 200)}${errorBody.length > 200 ? '...' : ''}`;
                }
                console.warn("Local server error response was not JSON, or was an HTML error page. Status:", response.status, parseError);
            }
        }
      } catch (e) {
        console.warn("Could not read error response body from local server:", e);
      }
      return { success: false, message: errorMessage };
    }

    // If response.ok is true
    const resultText = await response.text();
    if (!resultText) {
        return { success: false, message: "Local server returned a successful status but an empty response."};
    }

    try {
        const result: UploadResponse = JSON.parse(resultText);

        if (result.status === "ok" && result.path) {
          return { success: true, message: `File saved locally at: ${result.path}`, filePath: result.path };
        } else {
          return { success: false, message: result.message || "Local server reported an issue with saving the file, but returned a 2xx status." };
        }
    } catch (error: any) {
      console.error("Error parsing successful response from local server (expected JSON):", error);
      return { success: false, message: `Local server returned a 2xx status, but the response was not valid JSON. Response: ${resultText.substring(0, 200)}${resultText.length > 200 ? '...' : ''}` };
    }

  } catch (error: any) {
    console.error("Error uploading file to local server:", error);
    let connectMessage = "Could not connect to the local file saving service. Please ensure it is running on your device (at http://localhost:3001) and try again.";
    if (error.message && error.message.toLowerCase().includes('failed to fetch')) {
         connectMessage = "Connection to the local file saving service failed. Please ensure it's running and accessible at http://localhost:3001.";
    } else if (error.message) {
        connectMessage += ` Details: ${error.message}`;
    }
    return { success: false, message: connectMessage };
  }
}

