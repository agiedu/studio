
"use client";

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { AppProviders } from '@/components/app/AppProviders';

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
