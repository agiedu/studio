import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { ContentProtection } from '@/components/security/ContentProtection';

export const metadata: Metadata = {
  title: 'MangaTalk',
  description: 'Read manga aloud with OCR and TTS',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,200..900;1,7..72,200..900&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased flex flex-col min-h-screen bg-background">
        <ContentProtection />
        <main className="flex-grow flex flex-col">
          {children}
        </main>
        <Toaster />
      </body>
    </html>
  );
}
