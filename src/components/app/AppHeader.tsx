
"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Moon, Sun, BookOpenText, Library, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MangaTalkLogo } from '@/components/icons/MangaTalkLogo';
import * as LocalStorage from '@/lib/localStorageService'; // Import for night mode

export function AppHeader() {
  const [isDarkMode, setIsDarkMode] = useState(true);

  useEffect(() => {
    const root = window.document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    LocalStorage.saveNightMode(isDarkMode); // Save night mode preference
  }, [isDarkMode]);

  useEffect(() => {
    setIsDarkMode(LocalStorage.loadNightMode()); // Load night mode preference
  }, []);


  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-2 md:gap-4">
          <Link href="/" className="flex items-center gap-2">
            <MangaTalkLogo className="h-8 w-8" />
            <h1 className="text-xl md:text-2xl font-bold font-headline text-primary">MangaTalk</h1>
          </Link>
          <nav className="flex items-center gap-1 md:gap-2">
            <Button variant="ghost" asChild size="sm">
              <Link href="/library">
                <Library className="mr-1 h-4 w-4" /> Library
              </Link>
            </Button>
            <Button variant="ghost" asChild size="sm">
              <Link href="/reader">
                <BookOpenText className="mr-1 h-4 w-4" /> Reader
              </Link>
            </Button>
             <Button variant="ghost" asChild size="sm">
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
