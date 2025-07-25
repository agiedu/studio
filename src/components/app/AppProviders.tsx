"use client";

import { PlaybackProvider } from '@/components/player/PlaybackProvider';
import { ContentProtection } from '@/components/security/ContentProtection';
import { AppHeader } from '@/components/app/AppHeader';
import FloatingPlayer from '@/components/player/FloatingPlayer';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <PlaybackProvider>
      <ContentProtection />
      <AppHeader />
      <main className="flex-grow flex flex-col">
        {children}
      </main>
      <FloatingPlayer />
    </PlaybackProvider>
  );
}
