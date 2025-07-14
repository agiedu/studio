// src/ai/flows/cloud-text-to-speech.ts
'use server';

/**
 * @fileOverview Implements cloud-based TTS using the Edge TTS OpenAI-compatible API.
 *
 * - cloudTTS - A function to convert text to speech using the cloud TTS service.
 * - CloudTTSInput - The input type for the cloudTTS function.
 * - CloudTTSOutput - The return type for the cloudTTS function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const CloudTTSInputSchema = z.object({
  text: z.string().describe('The text to convert to speech.'),
  voice: z.string().optional().describe('The voice for TTS, e.g., "en-US-JennyNeural".'),
});
export type CloudTTSInput = z.infer<typeof CloudTTSInputSchema>;

const CloudTTSOutputSchema = z.object({
  audioUrl: z.string().describe('The URL of the generated audio file.'),
});
export type CloudTTSOutput = z.infer<typeof CloudTTSOutputSchema>;

export async function cloudTTS(input: CloudTTSInput): Promise<CloudTTSOutput> {
  return cloudTTSFlow(input);
}

const API_BASE_URL = 'https://yu.yayaxueyu.dpdns.org'; // Based on the user-referenced project
const PUNCTUATION_REGEX = /[.,?!,。？！，、\n]/g;

const cloudTTSFlow = ai.defineFlow(
  {
    name: 'cloudTTSFlow',
    inputSchema: CloudTTSInputSchema,
    outputSchema: CloudTTSOutputSchema,
  },
  async (input) => {
    try {
      // Pre-process the text to remove punctuation, matching local TTS behavior.
      const processedText = input.text.replace(PUNCTUATION_REGEX, ' ').trim();

      if (!processedText) {
        // If text is only punctuation, it becomes empty. Return a silent audio to prevent errors.
        return { audioUrl: 'data:audio/mpeg;base64,' }; // Empty MP3 data
      }

      console.log(`[CloudTTS] Requesting speech for voice: ${input.voice}, text: "${processedText.substring(0, 50)}..."`);
      
      const response = await fetch(`${API_BASE_URL}/v1/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'edge', // This model name is specific to this API implementation
          input: processedText, // Use the processed text
          voice: input.voice || 'en-US-JennyNeural', // Default voice if not provided
        }),
      });

      if (!response.ok) {
        let errorBody = 'Unknown error';
        const responseText = await response.text(); // Read the body once
        try {
            // Try to parse the error response as JSON from the text
            const errorJson = JSON.parse(responseText);
            errorBody = errorJson.error?.message || JSON.stringify(errorJson);
        } catch (e) {
            // If parsing fails, use the raw text body
            errorBody = responseText;
        }
        throw new Error(`API request failed with status ${response.status}: ${errorBody}`);
      }

      // The API returns the audio file directly in the body
      const audioBuffer = await response.arrayBuffer();
      const base64Audio = Buffer.from(audioBuffer).toString('base64');
      const audioUrl = `data:audio/mpeg;base64,${base64Audio}`;

      console.log(`[CloudTTS] Successfully generated audio data URI.`);
      return { audioUrl };

    } catch (error: any) {
      console.error('[CloudTTS] Flow failed:', error);
      // Re-throw the error to be handled by the caller (e.g., in actions.ts)
      throw new Error(`Failed to generate speech: ${error.message}`);
    }
  }
);
