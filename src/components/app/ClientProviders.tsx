
"use client";

import { LanguageProvider } from '@/context/LanguageContext';
import { AppProviders } from '@/components/app/AppProviders';

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <AppProviders>
        {children}
      </AppProviders>
    </LanguageProvider>
  );
}
