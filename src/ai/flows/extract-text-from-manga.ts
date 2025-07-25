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
      'A photo of a manga page, as a data URI that must include a MIME type and use Base64 encoding. Expected format: \'data:<mimetype>;base64,<encoded_data>\'.' // Corrected typo here
    ),
});

export type ExtractTextFromMangaInput = z.infer<typeof ExtractTextFromMangaInputSchema>;

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
  input: {schema: ExtractTextFromMangaInputSchema},
  output: {schema: ExtractTextFromMangaOutputSchema},
  prompt: [
    {text: 'You are an expert OCR reader, skilled at extracting text from images of manga pages. Extract the text from the following manga page image:'},
    {media: {url: '{{{photoDataUri}}}'}},
  ],
});

const extractTextFromMangaFlow = ai.defineFlow(
  {
    name: 'extractTextFromMangaFlow',
    inputSchema: ExtractTextFromMangaInputSchema,
    outputSchema: ExtractTextFromMangaOutputSchema,
  },
  async input => {
    const {output} = await extractTextPrompt(input);
    return output!;
  }
);
