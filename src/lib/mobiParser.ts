
// A client-side parser for MOBI format ebooks, based on the user-provided reference.
// This parser extracts basic metadata and text content. It does not handle all MOBI features.

// Type Definitions
export interface MobiBook {
  title: string;
  content: string;
  author: string;
  totalLength: number;
}

interface PDBRecord {
  offset: number;
}

interface PalmDocHeader {
  compression: number;
  textLength: number;
  textRecords: number;
  recordSize: number;
}

interface MobiHeader {
  title: string;
  author: string;
}

// Main Parser Class
export class MobiParser {

  public static async parseMobi(fileData: ArrayBuffer): Promise<MobiBook> {
    const bytes = new Uint8Array(fileData);

    // Verify PDB header
    if (!this.isPDBFile(bytes)) {
      throw new Error('Not a valid MOBI file (PDB header mismatch).');
    }

    // Parse PDB records
    const records = this.parsePDBRecords(bytes);
    if (records.length === 0) {
      throw new Error('Could not find any records in the PDB file.');
    }

    // Parse headers
    const palmDocHeader = this.parsePalmDocHeader(bytes, records[0].offset);
    const mobiHeader = this.parseMobiHeader(bytes, records[0].offset + 16);

    // Extract text
    const textRecords = records.slice(1, palmDocHeader.textRecords + 1);
    const rawText = this.extractTextFromRecords(bytes, textRecords, records[palmDocHeader.textRecords + 1]?.offset);
    const decompressedText = this.decompressText(rawText, palmDocHeader.compression);
    const cleanText = this.cleanHtmlContent(decompressedText);

    return {
      title: mobiHeader.title || 'Untitled MOBI',
      content: cleanText,
      author: mobiHeader.author || 'Unknown Author',
      totalLength: cleanText.length
    };
  }

  private static isPDBFile(bytes: Uint8Array): boolean {
    if (bytes.length < 78) return false;
    const type = new TextDecoder().decode(bytes.slice(60, 64));
    const creator = new TextDecoder().decode(bytes.slice(64, 68));
    return type === 'BOOK' && creator === 'MOBI';
  }

  private static parsePDBRecords(bytes: Uint8Array): PDBRecord[] {
    const numRecords = this.readUint16(bytes, 76);
    const records: PDBRecord[] = [];
    for (let i = 0; i < numRecords; i++) {
      const recordOffset = 78 + i * 8;
      const offset = this.readUint32(bytes, recordOffset);
      records.push({ offset });
    }
    return records;
  }

  private static parsePalmDocHeader(bytes: Uint8Array, offset: number): PalmDocHeader {
    return {
      compression: this.readUint16(bytes, offset),
      textLength: this.readUint32(bytes, offset + 4),
      textRecords: this.readUint16(bytes, offset + 8),
      recordSize: this.readUint16(bytes, offset + 10)
    };
  }

  private static parseMobiHeader(bytes: Uint8Array, offset: number): MobiHeader {
    let title = '';
    const author = ''; // Author extraction is more complex, skipping for now.

    try {
      const titleOffset = this.readUint32(bytes, offset + 84);
      const titleLength = this.readUint32(bytes, offset + 88);
      if (titleOffset > 0 && titleLength > 0 && (titleOffset + titleLength) <= bytes.length) {
        title = new TextDecoder('utf-8').decode(bytes.slice(titleOffset, titleOffset + titleLength));
      }
    } catch (e) {
      console.warn('Failed to extract title:', e);
    }

    return { title, author };
  }

  private static extractTextFromRecords(bytes: Uint8Array, records: PDBRecord[], endOffset?: number): Uint8Array {
    const textChunks: Uint8Array[] = [];
    for (let i = 0; i < records.length; i++) {
      const start = records[i].offset;
      const end = (i + 1 < records.length) ? records[i + 1].offset : (endOffset || bytes.length);
      textChunks.push(bytes.slice(start, end));
    }
    
    // Concatenate all chunks into a single Uint8Array
    let totalLength = 0;
    for(const chunk of textChunks) {
        totalLength += chunk.length;
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for(const chunk of textChunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
  }
  
  private static decompressText(bytes: Uint8Array, compression: number): string {
    if (compression === 1) { // No compression
        // Fallback for simple text decoding if needed
        try {
            return new TextDecoder('utf-8').decode(bytes);
        } catch (e) {
            // If UTF-8 fails, try a more lenient encoding
            const
 
fallbackText = [];
            for(let i = 0; i < bytes.length; i++) {
                fallbackText.push(String.fromCharCode(bytes[i]));
            }
            return fallbackText.join('');
        }
    } else if (compression === 2) { // PalmDOC compression
      return this.palmDocDecompress(bytes);
    }
    throw new Error(`Unsupported compression type: ${compression}`);
  }

  private static palmDocDecompress(compressedBytes: Uint8Array): string {
    const result: number[] = [];
    let i = 0;
    while (i < compressedBytes.length) {
      const byte = compressedBytes[i];
      i++;

      if (byte >= 1 && byte <= 8) { // Literal
        for (let j = 0; j < byte; j++) {
            if (i < compressedBytes.length) {
                result.push(compressedBytes[i]);
                i++;
            }
        }
      } else if (byte < 128) { // Literal
        result.push(byte);
      } else if (byte >= 192) { // Space + char
        result.push(32); // space
        result.push(byte ^ 128);
      } else if (byte >= 128 && i < compressedBytes.length) {
          const nextByte = compressedBytes[i];
          i++;
          const distance = (((byte << 8) | nextByte) >> 3) & 0x7FF;
          const length = (nextByte & 0x07) + 3;

          if (distance > result.length) continue;
          
          for (let j = 0; j < length; j++) {
            result.push(result[result.length - distance]);
          }
      }
    }
    // Convert the array of char codes to a string
    // Using TextDecoder is more robust for multi-byte characters
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(result));
  }

  private static cleanHtmlContent(htmlContent: string): string {
    const cleanText = htmlContent
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
    return cleanText;
  }

  // Helper methods to read multi-byte numbers from the byte array
  private static readUint16(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] << 8) | bytes[offset + 1];
  }

  private static readUint32(bytes: Uint8Array, offset: number): number {
    return (
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]
    );
  }
}

    