"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser, isAdminSessionActive } from '@/lib/authService';
import { Loader2 } from 'lucide-react';

// This guard protects pages that require a standard user to be logged in.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
        const user = getCurrentUser();
        if (!user) {
          router.replace('/login');
        } else {
          setIsVerified(true);
        }
    }
  }, [router]);

  if (!isVerified) {
    return (
        <div className="flex h-screen w-full items-center justify-center bg-background">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2">Verifying session...</p>
        </div>
    );
  }

  return <>{children}</>;
}

// This guard specifically protects the admin management pages.
export function AdminAuthGuard({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const [isVerified, setIsVerified] = useState(false);
  
    useEffect(() => {
      if (typeof window !== 'undefined') {
        if (!isAdminSessionActive()) {
            // Redirect to the normal user login page if not an admin.
            // This prevents non-admins from even knowing about the admin login URL.
            router.replace('/login');
        } else {
            setIsVerified(true);
        }
      }
    }, [router]);
  
    if (!isVerified) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-background">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-2">Verifying admin session...</p>
            </div>
        );
    }
  
    return <>{children}</>;
  }
