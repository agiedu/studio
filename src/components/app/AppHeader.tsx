
"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Moon, Sun, BookOpenText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MangaTalkLogo } from '@/components/icons/MangaTalkLogo';

export function AppHeader() {
  const [isDarkMode, setIsDarkMode] = useState(true); // Default to dark mode

  useEffect(() => {
    const root = window.document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    } catch (e) {
      // localStorage not available
    }
  }, [isDarkMode]);

  useEffect(() => {
    try {
      const storedTheme = localStorage.getItem('theme');
      if (storedTheme) {
        setIsDarkMode(storedTheme === 'dark');
      } else {
        // If no theme stored, check system preference. Default to dark if no preference.
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        setIsDarkMode(prefersDark);
      }
    } catch (e) {
       // localStorage not available, default to dark
       setIsDarkMode(true);
    }

  }, []);


  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <MangaTalkLogo className="h-8 w-8" />
            <h1 className="text-2xl font-bold font-headline text-primary">MangaTalk</h1>
          </Link>
          <nav className="flex items-center gap-2">
            <Button variant="ghost" asChild size="sm">
              <Link href="/reader">
                <BookOpenText className="mr-1 h-4 w-4" /> Document Reader
              </Link>
            </Button>
          </nav>
        </div>
        {/* Placeholder for future UI language switcher */}
        {/* <Button variant="ghost" size="icon" aria-label="Switch Language">
          <Globe className="h-5 w-5" />
        </Button> */}
        <Button variant="ghost" size="icon" onClick={toggleDarkMode} aria-label="Toggle theme">
          {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
      </div>
    </header>
  );
}

    