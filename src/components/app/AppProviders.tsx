
"use client";

import { LanguageProvider } from '@/context/LanguageContext';
import { PlaybackProvider } from '@/components/player/PlaybackProvider';
import { ContentProtection } from '@/components/security/ContentProtection';
import { AppHeader } from '@/components/app/AppHeader';
import FloatingPlayer from '@/components/player/FloatingPlayer';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
        <PlaybackProvider>
            <ContentProtection />
            <AppHeader />
            <main className="flex-grow flex flex-col">
                {children}
            </main>
            <FloatingPlayer />
        </PlaybackProvider>
    </LanguageProvider>
  );
}
