
"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Trash2, Info, NotebookText, FileText } from 'lucide-react';
import * as LocalStorage from '@/lib/localStorageService';
import type { NoteFavoriteItem } from '@/types';
import { format } from 'date-fns';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AppHeader } from '@/components/app/AppHeader';
import { cn } from '@/lib/utils';
import NextImage from 'next/image';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function NotesFavoritesPageContent() {
  const { toast } = useToast();
  const [favoriteNotes, setFavoriteNotes] = useState<NoteFavoriteItem[]>([]);
  const [noteToDelete, setNoteToDelete] = useState<NoteFavoriteItem | null>(null);

  useEffect(() => {
    setFavoriteNotes(LocalStorage.loadNoteFavorites());
  }, []);

  const performDelete = () => {
    if (!noteToDelete) return;

    LocalStorage.deleteNoteFavorite(noteToDelete.id);
    setFavoriteNotes(prev => prev.filter(item => item.id !== noteToDelete.id));
    toast({ title: "Note Favorite Removed" });
    setNoteToDelete(null); // Close the dialog
  };

  return (
    <>
      <AppHeader />
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><NotebookText className="text-primary" /> My Note Favorites</CardTitle>
            <CardDescription>Your saved annotations. Click to review or delete.</CardDescription>
          </CardHeader>
          <CardContent>
            {favoriteNotes.length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-2"><Info className="h-5 w-5" /> Your note favorites list is empty. In the reader, select text, add a note, and then save it to favorites.</p>
            ) : (
              <ul className="space-y-4">
                {favoriteNotes.map(item => (
                  <li key={item.id} className="p-4 border rounded-md flex flex-col justify-between gap-4 bg-card hover:shadow-md transition-shadow">
                    <div className="flex-grow space-y-3">
                        <div className="p-3 bg-muted/50 rounded-md">
                            <p className="text-xs text-muted-foreground mb-1">Original Text:</p>
                            <p className="text-sm italic">&quot;{item.annotation.targetText}&quot;</p>
                        </div>

                        <div className="p-3 bg-background rounded-md border">
                             <p className="text-xs text-muted-foreground mb-1">Your Note:</p>
                            <p className={cn("text-sm whitespace-pre-wrap", !item.annotation.note && "italic text-muted-foreground")}>
                                {item.annotation.note || "No text note provided."}
                            </p>
                        </div>
                      
                        {item.annotation.imageDataUrl && (
                            <div className="p-2 border rounded-md">
                                <p className="text-xs text-muted-foreground mb-2">Attached Image:</p>
                                <div className="relative w-full max-w-xs">
                                     <NextImage src={item.annotation.imageDataUrl} alt="Annotation attachment" width={300} height={200} className="rounded-md object-contain" />
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between pt-3 border-t">
                         <p className="text-xs text-muted-foreground">
                          {item.sourceDocumentName && <span className="flex items-center gap-1"><FileText className="h-3 w-3"/> From: {item.sourceDocumentName} | </span>}
                          Favorited: {format(new Date(item.favoritedAt), "MMM d, yyyy HH:mm")}
                        </p>
                        <Button size="sm" variant="ghost" onClick={() => setNoteToDelete(item)} aria-label="Delete Note Favorite">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
          {favoriteNotes.length > 0 && (
            <CardFooter>
              <p className="text-xs text-muted-foreground">Your note favorites are stored in your browser's local storage.</p>
            </CardFooter>
          )}
        </Card>
      </div>
      
      <AlertDialog open={!!noteToDelete} onOpenChange={(isOpen) => !isOpen && setNoteToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete this note favorite. The original annotation in the document will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function NotesFavoritesPage() {
    return (
        <AuthGuard>
            <NotesFavoritesPageContent />
        </AuthGuard>
    );
}

    
