
"use client";

import { usePlayback } from '@/components/player/PlaybackProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Play, Pause, SkipBack, SkipForward, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

export default function FloatingPlayer() {
  const {
    isPlaying,
    isPaused,
    isLoading,
    currentItem,
    currentText,
    playlist,
    play,
    pause,
    resume,
    next,
    previous,
    stop,
    hasNext,
    hasPrevious,
  } = usePlayback();

  const handlePlayPause = () => {
    if (isPlaying) {
      if (isPaused) {
        resume();
      } else {
        pause();
      }
    } else if (playlist.length > 0) {
      // If stopped, play from the beginning of the current playlist
      play(playlist[0], playlist, 0);
    }
  };

  const getPlayButtonIcon = () => {
    if (isLoading) return <Loader2 className="h-5 w-5 animate-spin" />;
    if (isPlaying && !isPaused) return <Pause className="h-5 w-5" />;
    return <Play className="h-5 w-5" />;
  };

  const getPlayButtonText = () => {
    if (isLoading) return "Loading";
    if (isPlaying && !isPaused) return "Pause";
    if (isPaused) return "Resume";
    return "Play";
  }

  const truncateText = (text: string, length = 100) => {
    if (text.length <= length) return text;
    return text.substring(0, length) + '...';
  };
  
  const sourceText = currentItem?.type === 'note_favorite' 
    ? `Note for: "${truncateText(currentItem.item.annotation.targetText, 50)}"`
    : currentItem?.item.sourceDocumentName || 'Favorite Item';


  return (
    <AnimatePresence>
      {isPlaying && currentItem && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed bottom-0 left-0 right-0 z-50 p-2 md:p-4 flex justify-center"
        >
          <Card className="w-full max-w-lg shadow-2xl bg-background/80 backdrop-blur-sm">
            <CardContent className="p-4 flex items-center gap-4 relative">
                <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={stop}>
                    <X className="h-4 w-4"/>
                    <span className="sr-only">Close Player</span>
                </Button>
              <div className="flex-grow min-w-0">
                <p className="text-sm font-medium truncate text-primary" title={currentText}>
                    {currentText ? `“${truncateText(currentText)}”` : 'Loading...'}
                </p>
                <p className="text-xs text-muted-foreground truncate" title={sourceText}>
                  {sourceText}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={previous}
                  disabled={!hasPrevious() || isLoading}
                  aria-label="Previous"
                >
                  <SkipBack className="h-5 w-5" />
                </Button>
                <Button
                  variant="default"
                  size="icon"
                  className="h-12 w-12 rounded-full"
                  onClick={handlePlayPause}
                  disabled={isLoading}
                  aria-label={getPlayButtonText()}
                >
                  {getPlayButtonIcon()}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={next}
                  disabled={!hasNext() || isLoading}
                  aria-label="Next"
                >
                  <SkipForward className="h-5 w-5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
