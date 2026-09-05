# **App Name**: MangaTalk

## Core Features:

- PDF Viewer: Display PDF-formatted manga pages with controls for page navigation, zoom, and a toggle for night mode.
- OCR Text Extraction: Use OCR via google_ml_kit to extract text from manga pages (scanned images in PDF). The OCR tool is to ensure accurate and contextual text extraction for the TTS feature.
- Selectable Text Reading: Offer a selectable text reading functionality for selectable manga in PDFs, even without OCR.
- Local TTS Playback: Utilize flutter_tts for offline text-to-speech to read extracted text. User settings control voice, rate, and pitch.
- Cloud TTS (Optional): Connect to the API endpoint at https://1234.org/ to use cloud-based TTS for potentially more natural-sounding speech. The cloud TTS will serve as a tool and enhance the AI feature set for the application.
- Local Storage: Allow users to store books, reading progress and settings locally on their devices using shared_preferences and sqflite.
- Interactive Controls: Implement swipe gestures or button controls for page turning and text highlighting for interactive reading.

## Style Guidelines:

- Primary color: A soft, desaturated purple (#A38CBC) to evoke a sense of calm and focus, conducive to reading.
- Background color: Dark, almost black (#121212) for comfortable night reading, reducing eye strain.
- Accent color: A vibrant, contrasting magenta (#F06292) to highlight interactive elements and call to actions.
- Body and headline font: 'Literata' (serif) for comfortable long-form reading, lending a classic, literary feel.
- Simple, outline-style icons for controls and navigation. Consistent and minimalistic for ease of use.
- Clean and spacious layout with generous padding. Manga pages are given full focus on the screen.
- Subtle transitions for page turns and UI element appearance. Keep animations brief to prevent distraction.