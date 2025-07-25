
"use client";

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { UploadCloud, Info, Trash2, Loader2, Music, Video, MessageSquare, Play, Pause, Repeat1, ListOrdered, SkipBack, SkipForward } from 'lucide-react';
import * as IndexedDBService from '@/lib/indexedDBService';
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
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { usePlayback } from '@/components/player/PlaybackProvider';
import { cn } from '@/lib/utils';


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
  const objectUrlRefs = useRef<Record<string, string>>({});


  const {
    play,
    pause,
    resume,
    stop,
    next,
    previous,
    isPlaying,
    isPaused,
    isLoading: isPlaybackLoading,
    currentItem,
    playlist,
    playbackMode,
    setPlaybackMode,
    hasNext,
    hasPrevious,
  } = usePlayback();


  useEffect(() => {
    fetchItems();
    setPlaybackMode(LocalStorage.loadMediaPlaybackMode());
    
    return () => {
      // Clean up object URLs on component unmount
      Object.values(objectUrlRefs.current).forEach(URL.revokeObjectURL);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  useEffect(() => {
      LocalStorage.saveMediaPlaybackMode(playbackMode);
  }, [playbackMode]);

  const fetchItems = async () => {
    setIsLoading(true);
    try {
        const items = await IndexedDBService.getAllMediaItems();
        setMediaItems(items);
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Failed to load media', description: error.message });
    } finally {
        setIsLoading(false);
    }
  };
  
  const handlePlayPause = (item: MediaFavoriteItem) => {
    const isCurrentlyPlayingThis = currentItem?.item.id === item.id;
    if (isCurrentlyPlayingThis) {
        if (isPaused) {
            resume();
        } else {
            pause();
        }
    } else {
        const fullPlaylist = mediaItems.map(media => ({ type: 'media_favorite' as const, item: media }));
        const startIndex = mediaItems.findIndex(media => media.id === item.id);
        play({ type: 'media_favorite', item }, fullPlaylist, startIndex);
    }
  };
  
  const handleGlobalPlayPause = () => {
    if (isPlaying && !isPaused) {
      pause();
    } else if (isPlaying && isPaused) {
      resume();
    } else if (mediaItems.length > 0) {
      handlePlayPause(mediaItems[0]);
    }
  };


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
      const fileBuffer = await uploadDialog.file.arrayBuffer();
      const newItem: MediaFavoriteItem = {
        id: `media_${Date.now()}`,
        name: uploadDialog.file.name,
        type: uploadDialog.file.type.startsWith('audio') ? 'audio' : 'video',
        fileData: fileBuffer,
        originalType: uploadDialog.file.type,
        note: uploadDialog.note,
        createdAt: Date.now(),
        sourceDocumentName: 'Local Upload'
      };

      await IndexedDBService.saveMediaItem(newItem);
      toast({ title: 'Success', description: `"${newItem.name}" has been added.` });
      await fetchItems(); // Refresh the list
      
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Upload Failed', description: error.message });
    } finally {
      // Reset dialog and input
      setUploadDialog({ open: false, file: null, note: '' });
      if (fileInputRef.current) fileInputRef.current.value = "";
      setIsUploading(false);
    }
  };

  const performDelete = async () => {
    if (!itemToDelete) return;
    if (currentItem?.item.id === itemToDelete.id) stop();
    await IndexedDBService.deleteMediaItemById(itemToDelete.id);
    toast({ title: 'Deleted', description: `"${itemToDelete.name}" has been removed.` });
    setItemToDelete(null);
    await fetchItems();
  };
  
  const getMediaIcon = (type: 'audio' | 'video') => {
    return type === 'audio' 
      ? <Music className="h-6 w-6 text-primary flex-shrink-0" />
      : <Video className="h-6 w-6 text-primary flex-shrink-0" />;
  };

  // Function to create or get an object URL for a media item
  const getObjectUrl = (item: MediaFavoriteItem): string => {
    if (objectUrlRefs.current[item.id]) {
      return objectUrlRefs.current[item.id];
    }
    const blob = new Blob([item.fileData], { type: item.originalType });
    const url = URL.createObjectURL(blob);
    objectUrlRefs.current[item.id] = url;
    return url;
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

        <div className="p-4 border rounded-md bg-muted/20">
            <h3 className="text-lg font-medium mb-3">Playback Controls</h3>
            <div className="mb-4">
                <Label className="font-medium text-sm">Playback Mode</Label>
                <RadioGroup
                  value={playbackMode}
                  onValueChange={(v) => {
                    setPlaybackMode(v as 'default' | 'loop-single' | 'sequential');
                  }}
                  className="flex items-center gap-4 mt-2"
                  disabled={isPlaying}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="default" id="mode-default" />
                    <Label htmlFor="mode-default" className="flex items-center gap-1 cursor-pointer"><Play className="h-4 w-4"/>Default</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="loop-single" id="mode-loop" />
                    <Label htmlFor="mode-loop" className="flex items-center gap-1 cursor-pointer"><Repeat1 className="h-4 w-4"/>Loop Single</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="sequential" id="mode-sequential" />
                    <Label htmlFor="mode-sequential" className="flex items-center gap-1 cursor-pointer"><ListOrdered className="h-4 w-4"/>List loop mode</Label>
                  </div>
                </RadioGroup>
            </div>
            <div className="flex items-center justify-center gap-4 my-4 p-2 rounded-lg bg-muted/50">
               <Button variant="ghost" size="icon" onClick={previous} disabled={!hasPrevious() || isPlaybackLoading}><SkipBack className="h-5 w-5"/></Button>
               <Button variant="ghost" size="icon" onClick={handleGlobalPlayPause} disabled={isPlaybackLoading || mediaItems.length === 0}>
                  {isPlaybackLoading ? <Loader2 className="h-6 w-6 animate-spin"/> : isPlaying && !isPaused ? <Pause className="h-6 w-6"/> : <Play className="h-6 w-6"/>}
               </Button>
               <Button variant="ghost" size="icon" onClick={next} disabled={!hasNext() || isPlaybackLoading}><SkipForward className="h-5 w-5"/></Button>
            </div>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading media...</p>
        ) : mediaItems.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2"><Info className="h-5 w-5" /> Your media list is empty. Upload a file to get started.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {mediaItems.map((item) => {
              const isCurrentlyPlaying = currentItem?.item.id === item.id;
              
              let playButtonIcon;
              if (isPlaybackLoading && isCurrentlyPlaying) {
                  playButtonIcon = <Loader2 className="h-5 w-5 animate-spin" />;
              } else if (isPlaying && !isPaused && isCurrentlyPlaying) {
                  playButtonIcon = <Pause className="h-5 w-5" />;
              } else {
                  playButtonIcon = <Play className="h-5 w-5" />;
              }

              return (
              <Card key={item.id} className={cn("flex flex-col", isCurrentlyPlaying && "border-primary ring-2 ring-primary")}>
                <CardContent className="p-4 flex flex-col gap-3 flex-grow">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3 min-w-0">
                      {getMediaIcon(item.type)}
                      <div className='min-w-0'>
                        <p className={cn("font-semibold truncate")} title={item.name}>{item.name}</p>
                        <p className="text-xs text-muted-foreground">Added: {format(new Date(item.createdAt), "MMM d, yyyy HH:mm")}</p>
                      </div>
                    </div>
                     <div className="flex gap-2 mt-2 sm:mt-0 sm:items-center flex-shrink-0">
                          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setItemToDelete(item); }}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                    </div>
                  </div>
                  
                  <div className="w-full aspect-video bg-black rounded-md flex items-center justify-center relative">
                      {item.type === 'video' && (
                        <video 
                            src={getObjectUrl(item)}
                            className="w-full h-full object-contain"
                            // The video element is just for show; controls are handled globally
                        ></video>
                      )}
                      {item.type === 'audio' && (
                          <Music className="h-16 w-16 text-muted" />
                      )}
                      {/* Overlay Play Button */}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <Button
                              variant="ghost"
                              size="icon"
                              className="h-16 w-16 text-white hover:bg-white/20 hover:text-white"
                              onClick={() => handlePlayPause(item)}
                              disabled={isPlaybackLoading && isCurrentlyPlaying}
                          >
                              {playButtonIcon}
                          </Button>
                      </div>
                  </div>
                  
                  {item.note && (
                    <div className="text-sm text-muted-foreground p-3 bg-muted/50 rounded-md flex items-start gap-2 mt-auto">
                        <MessageSquare className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <p className="whitespace-pre-wrap">{item.note}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )})}
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
      
      <AlertDialog open={!!itemToDelete} onOpenChange={(isOpen) => !isOpen && setItemToDelete(null)}>
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
