
"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BookOpenText, Library, Star, User, LogOut, ShieldCheck, NotebookText, Home, Film, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MangaTalkLogo } from '@/components/icons/MangaTalkLogo';
import { cn } from '@/lib/utils';
import { getCurrentUser, logout, isAdminSessionActive } from '@/lib/authService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const PROTECTED_ROUTES = ['/library', '/reader', '/favorites', '/notes-favorites', '/profile', '/admin', '/media'];

const languages = [
    { code: 'en', name: 'English' },
    { code: 'zh-CN', name: '简体中文' },
    { code: 'zh-TW', name: '繁體中文' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
    { code: 'ru', name: 'Русский' },
    { code: 'pt', name: 'Português' },
    { code: 'it', name: 'Italiano' },
    { code: 'ar', name: 'العربية' },
    { code: 'hi', name: 'हिन्दी' },
];


export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState('en');

  useEffect(() => {
    const currentUser = getCurrentUser();
    setUser(currentUser);
    setIsAdmin(isAdminSessionActive());

    // If on a protected route without a user, redirect to home.
    if (!currentUser && PROTECTED_ROUTES.some(route => pathname.startsWith(route))) {
      router.replace('/');
    }
  }, [pathname, router]);

  const handleLogout = () => {
    logout();
    setUser(null);
    setIsAdmin(false);
    router.push('/');
  };

  const getLinkClass = (path: string) => {
    const isActive = pathname.startsWith(path);
    return cn(
      "flex items-center gap-1 md:gap-2",
      isActive && "bg-accent text-accent-foreground rounded-md"
    );
  };
  
  // Hide header on the new root page, login, and register pages.
  if (pathname === '/' || pathname.startsWith('/login') || pathname.startsWith('/register')) {
      return null;
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-2 md:gap-4">
          <Link href="/" className="flex items-center gap-2">
            <MangaTalkLogo className="h-8 w-8" />
            <h1 className="text-xl md:text-2xl font-bold font-headline text-primary">MangaTalk</h1>
          </Link>
          <nav className="flex items-center gap-1 md:gap-2">
            {user && (
              <>
                <Button variant="ghost" asChild size="sm" className={getLinkClass('/')}>
                  <Link href="/">
                    <Home className="mr-1 h-4 w-4" /> Home
                  </Link>
                </Button>
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
                 <Button variant="ghost" asChild size="sm" className={getLinkClass('/media')}>
                  <Link href="/media">
                    <Film className="mr-1 h-4 w-4" /> Media
                  </Link>
                </Button>
                <Button variant="ghost" asChild size="sm" className={getLinkClass('/favorites')}>
                  <Link href="/favorites">
                    <Star className="mr-1 h-4 w-4" /> Favorites
                  </Link>
                </Button>
                <Button variant="ghost" asChild size="sm" className={getLinkClass('/notes-favorites')}>
                  <Link href="/notes-favorites">
                    <NotebookText className="mr-1 h-4 w-4" /> Notes
                  </Link>
                </Button>
                <Button variant="ghost" asChild size="sm" className={getLinkClass('/profile')}>
                  <Link href="/profile">
                    <User className="mr-1 h-4 w-4" /> Profile
                  </Link>
                </Button>
                {isAdmin && (
                   <Button variant="ghost" asChild size="sm" className={getLinkClass('/admin/management')}>
                      <Link href="/admin/management">
                          <ShieldCheck className="mr-1 h-4 w-4" /> Admin
                      </Link>
                  </Button>
                )}
              </>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-2">
            <Select value={currentLanguage} onValueChange={setCurrentLanguage}>
                <SelectTrigger className="w-auto h-9 border-none focus:ring-0">
                    <SelectValue asChild>
                         <div className="flex items-center gap-2">
                            <Languages className="h-4 w-4" />
                            <span className="hidden md:inline">{languages.find(l => l.code === currentLanguage)?.name}</span>
                         </div>
                    </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                    {languages.map(lang => (
                        <SelectItem key={lang.code} value={lang.code}>{lang.name}</SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {user ? (
                <Button variant="ghost" size="sm" onClick={handleLogout}>
                    <LogOut className="mr-1 h-4 w-4" /> Logout
                </Button>
            ) : (
                 <Button variant="ghost" size="sm" asChild>
                    <Link href="/login">Login</Link>
                </Button>
            )}
        </div>
      </div>
    </header>
  );
}
