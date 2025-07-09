
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/authService';
import { Loader2 } from 'lucide-react';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // This check runs only on the client-side
    if (getCurrentUser()) {
      router.replace('/library');
    } else {
      router.replace('/login');
    }
  }, [router]);

  // Render a loading state while the redirect is happening
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin" />
    </div>
  );
}
