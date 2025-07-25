// 'use server';

/**
 * @fileOverview Extracts text from manga pages using OCR.
 *
 * - extractTextFromManga - A function that handles the text extraction process.
 * - ExtractTextFromMangaInput - The input type for the extractTextFromManga function.
 * - ExtractTextFromMangaOutput - The return type for the extractTextFromManga function.
 */

'use server';

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ExtractTextFromMangaInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      'A photo of a manga page, as a data URI that must include a MIME type and use Base64 encoding. Expected format: \'data:<mimetype>;base64,<encoded_data>\'.'
    ),
});

export type ExtractTextFromMangaInput = z.infer<typeof ExtractTextFromMangaInputSchema>;

// Extended schema for the prompt, which needs the contentType separately.
const PromptInputSchema = ExtractTextFromMangaInputSchema.extend({
  contentType: z.string().describe("The MIME type of the photo, e.g., 'image/png'."),
});


const ExtractTextFromMangaOutputSchema = z.object({
  extractedText: z
    .string()
    .describe('The extracted text from the manga page using OCR.'),
});

export type ExtractTextFromMangaOutput = z.infer<typeof ExtractTextFromMangaOutputSchema>;

export async function extractTextFromManga(
  input: ExtractTextFromMangaInput
): Promise<ExtractTextFromMangaOutput> {
  return extractTextFromMangaFlow(input);
}

const extractTextPrompt = ai.definePrompt({
  name: 'extractTextPrompt',
  model: 'googleai/gemini-pro-vision', // Explicitly use the vision model
  input: {schema: PromptInputSchema}, // Use the extended schema
  output: {schema: ExtractTextFromMangaOutputSchema},
  prompt: `You are an expert OCR reader, skilled at extracting text from images of manga pages. Extract the text from the following manga page image:
{{media url=photoDataUri contentType=contentType}}`,
});


const extractTextFromMangaFlow = ai.defineFlow(
  {
    name: 'extractTextFromMangaFlow',
    inputSchema: ExtractTextFromMangaInputSchema,
    outputSchema: ExtractTextFromMangaOutputSchema,
  },
  async input => {
    // Extract the MIME type from the data URI.
    const mimeTypeMatch = input.photoDataUri.match(/^data:(.*?);base64,/);
    if (!mimeTypeMatch) {
      throw new Error('Invalid data URI format. Could not extract MIME type.');
    }
    const contentType = mimeTypeMatch[1];
    
    // Call the prompt with the separated photoDataUri and contentType.
    const {output} = await extractTextPrompt({
        photoDataUri: input.photoDataUri,
        contentType: contentType,
    });
    
    return output!;
  }
);
