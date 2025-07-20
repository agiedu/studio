
"use client";

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { UploadCloud, Info, Trash2, Loader2, Music, Video, MessageSquare } from 'lucide-react';
import * as LocalStorage from '@/lib/localStorageService';
import type { MediaFavoriteItem } from '@/types';
import { format } from 'date-fns';
import { AuthGuard } from '@/components/auth/AuthGuard';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

function MediaFavoritesPageContent() {
  const { toast } = useToast();
  const [mediaItems, setMediaItems] = useState<MediaFavoriteItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  
  const [itemToDelete, setItemToDelete] = useState<MediaFavoriteItem | null>(null);
  
  const [uploadDialog, setUploadDialog] = useState<{
    open: boolean;
    file: File | null;
    note: string;
  }>({ open: false, file: null, note: '' });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement | HTMLVideoElement>>(new Map());

  const fetchItems = () => {
    setMediaItems(LocalStorage.loadMediaFavorites());
  };

  useEffect(() => {
    fetchItems();
    setIsLoading(false);
  }, []);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
        setUploadDialog({ open: true, file, note: '' });
      } else {
        toast({
          variant: 'destructive',
          title: 'Unsupported File Type',
          description: 'Please select a valid audio or video file.',
        });
      }
    }
  };

  const handleUploadConfirm = async () => {
    if (!uploadDialog.file) return;

    setIsUploading(true);
    
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const newItem: MediaFavoriteItem = {
          id: `media_${Date.now()}`,
          name: uploadDialog.file!.name,
          type: uploadDialog.file!.type.startsWith('audio') ? 'audio' : 'video',
          dataUrl: dataUrl,
          note: uploadDialog.note,
          createdAt: Date.now(),
        };

        LocalStorage.addMediaFavorite(newItem);
        fetchItems(); // Refresh the list
        toast({ title: 'Success', description: `"${newItem.name}" has been added.` });
        
        // Reset dialog and input
        setUploadDialog({ open: false, file: null, note: '' });
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        setIsUploading(false);
      };
      reader.onerror = () => {
        throw new Error("Failed to read the file.");
      }
      reader.readAsDataURL(uploadDialog.file);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Upload Failed', description: error.message });
      setIsUploading(false);
    }
  };

  const performDelete = () => {
    if (!itemToDelete) return;
    LocalStorage.deleteMediaFavorite(itemToDelete.id);
    fetchItems();
    toast({ title: 'Deleted', description: `"${itemToDelete.name}" has been removed.` });
    setItemToDelete(null);
  };
  
  const getMediaIcon = (type: 'audio' | 'video') => {
    return type === 'audio' 
      ? <Music className="h-6 w-6 text-primary flex-shrink-0" />
      : <Video className="h-6 w-6 text-primary flex-shrink-0" />;
  };

  return (
    <>
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UploadCloud className="text-primary" /> Upload Media
            </CardTitle>
            <CardDescription>
              Add your own audio or video files to your favorites list.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
              Select Audio/Video File
            </Button>
            <Input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={handleFileSelect}
            />
             {isUploading && <p className="mt-2 text-sm text-muted-foreground flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing and saving...</p>}
          </CardContent>
        </Card>

        {isLoading ? (
          <p className="text-muted-foreground flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading media...</p>
        ) : mediaItems.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2"><Info className="h-5 w-5" /> Your media list is empty. Upload a file to get started.</p>
        ) : (
          <div className="space-y-4">
            {mediaItems.map((item) => (
              <Card key={item.id}>
                <CardContent className="p-4 flex flex-col gap-3">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3 min-w-0">
                      {getMediaIcon(item.type)}
                      <div className='min-w-0'>
                        <p className="font-semibold truncate" title={item.name}>{item.name}</p>
                        <p className="text-xs text-muted-foreground">Added: {format(new Date(item.createdAt), "MMM d, yyyy HH:mm")}</p>
                      </div>
                    </div>
                    <AlertDialog>
                       <AlertDialogTrigger asChild>
                         <Button variant="ghost" size="icon" onClick={() => setItemToDelete(item)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                         </Button>
                       </AlertDialogTrigger>
                       <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete "{itemToDelete?.name}". This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setItemToDelete(null)}>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={performDelete}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                       </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  
                  {item.type === 'audio' ? (
                     <audio controls src={item.dataUrl} className="w-full"></audio>
                  ) : (
                     <video controls src={item.dataUrl} className="w-full rounded-md bg-black"></video>
                  )}
                  
                  {item.note && (
                    <div className="text-sm text-muted-foreground p-3 bg-muted/50 rounded-md flex items-start gap-2">
                        <MessageSquare className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <p className="whitespace-pre-wrap">{item.note}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={uploadDialog.open} onOpenChange={(isOpen) => !isOpen && setUploadDialog({ open: false, file: null, note: '' })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Note to Media</DialogTitle>
            <DialogDescription>
              File: <span className="font-semibold">{uploadDialog.file?.name}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="media-note">Note (optional)</Label>
            <Textarea
              id="media-note"
              value={uploadDialog.note}
              onChange={(e) => setUploadDialog(prev => ({ ...prev, note: e.target.value }))}
              placeholder="Add a description or comment..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialog({ open: false, file: null, note: '' })}>Cancel</Button>
            <Button onClick={handleUploadConfirm} disabled={isUploading}>
              {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save to Library
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


export default function MediaPage() {
    return (
        <AuthGuard>
            <MediaFavoritesPageContent />
        </AuthGuard>
    )
}
