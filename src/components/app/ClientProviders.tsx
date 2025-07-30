
"use client";

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

const AppProviders = dynamic(() => import('@/components/app/AppProviders').then(mod => mod.AppProviders), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  ),
});

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
