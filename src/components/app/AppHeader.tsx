
"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Moon, Sun, BookOpenText, Library, Star, Home as HomeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MangaTalkLogo } from '@/components/icons/MangaTalkLogo';
import * as LocalStorage from '@/lib/localStorageService';
import { cn } from '@/lib/utils';

export function AppHeader() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    const root = window.document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    LocalStorage.saveNightMode(isDarkMode);
  }, [isDarkMode]);

  useEffect(() => {
    setIsDarkMode(LocalStorage.loadNightMode());
  }, []);


  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  const getLinkClass = (path: string) => {
    // For reader, also highlight if path starts with /reader (e.g. /reader?docId=...)
    const isActive = path === '/reader' ? pathname.startsWith('/reader') : pathname === path;
    return cn(
      "flex items-center gap-1 md:gap-2",
      isActive && "bg-accent text-accent-foreground rounded-md"
    );
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-2 md:gap-4">
          <Link href="/library" className="flex items-center gap-2"> {/* Home link now points to library */}
            <MangaTalkLogo className="h-8 w-8" />
            <h1 className="text-xl md:text-2xl font-bold font-headline text-primary">MangaTalk</h1>
          </Link>
          <nav className="flex items-center gap-1 md:gap-2">
            <Button variant="ghost" asChild size="sm" className={getLinkClass('/library')}>
              <Link href="/library">
                <Library className="mr-1 h-4 w-4" /> Library
              </Link>
            </Button>
            <Button variant="ghost" asChild size="sm" className={getLinkClass('/reader')}>
              <Link href="/reader">
                <BookOpenText className="mr-1 h-4 w-4" /> Reader
              </Link>
            </Button>
             <Button variant="ghost" asChild size="sm" className={getLinkClass('/favorites')}>
              <Link href="/favorites">
                <Star className="mr-1 h-4 w-4" /> Favorites
              </Link>
            </Button>
          </nav>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleDarkMode} aria-label="Toggle theme">
          {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
      </div>
    </header>
  );
}
