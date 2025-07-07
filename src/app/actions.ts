
"use server";

import { extractTextFromManga, type ExtractTextFromMangaInput } from "@/ai/flows/extract-text-from-manga";
import { cloudTTS, type CloudTTSInput } from "@/ai/flows/cloud-text-to-speech";

export async function performOCR(
  imageDataUrl: string
): Promise<{ extractedText: string } | { error: string }> {
  if (!imageDataUrl || !imageDataUrl.startsWith('data:image')) {
    return { error: "Invalid image data URL provided." };
  }
  try {
    const input: ExtractTextFromMangaInput = { photoDataUri: imageDataUrl };
    const result = await extractTextFromManga(input);
    return { extractedText: result.extractedText };
  } catch (e: any) {
    console.error("OCR Error:", e);
    // Check for the specific FAILED_PRECONDITION error for missing API key
    if (e.message && e.message.includes('FAILED PRECONDITION') && e.message.toLowerCase().includes('api key')) {
        return { error: "Configuration Error: The GOOGLE_API_KEY is missing from your environment. This key is required for AI features like OCR. Please add it to your .env file and restart the server." };
    }
    return { error: e.message || "Failed to extract text using OCR." };
  }
}

export async function getCloudSpeech(
  text: string,
  language: string, // Kept for backward compatibility with Reader page
  voice?: string // Optional voice name for specific voice selection
): Promise<{ audioUrl: string } | { error: string }> {
  if (!text) {
    return { error: "No text provided for Cloud TTS." };
  }
  try {
    const input: CloudTTSInput = { text, voice };
    const result = await cloudTTS(input);
    return { audioUrl: result.audioUrl };
  } catch (e: any) {
    console.error("Cloud TTS Error:", e);
    return { error: e.message || "Failed to generate speech using Cloud TTS." };
  }
}

    
