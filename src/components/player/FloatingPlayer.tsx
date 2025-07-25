
"use client";

import { usePlayback } from '@/components/player/PlaybackProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Play, Pause, SkipBack, SkipForward, Loader2, X, Maximize, Minimize } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';

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
    videoPlayerRef, // Get the video player ref from the provider
  } = usePlayback();

  const [size, setSize] = useState({ width: 512, height: 'auto' });
  const [isMaximized, setIsMaximized] = useState(false);


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

  const isVideo = currentItem?.type === 'media_favorite' && currentItem.item.type === 'video';

  const toggleMaximize = () => {
      if (isMaximized) {
        setSize({ width: 512, height: 'auto' });
      } else {
        setSize({ width: window.innerWidth * 0.9, height: window.innerHeight * 0.9 });
      }
      setIsMaximized(!isMaximized);
  };

  return (
    <AnimatePresence>
      {isPlaying && currentItem && (
        <motion.div
          drag
          dragMomentum={false}
          className="fixed bottom-4 right-4 z-50"
          style={{ width: size.width, height: size.height }}
          initial={{ y: '110%' }}
          animate={{ y: 0 }}
          exit={{ y: '110%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <Card className="w-full h-full shadow-2xl bg-background/80 backdrop-blur-sm flex flex-col overflow-hidden resize-x" >
            
            <div className="p-1 flex items-center justify-end bg-background/50 cursor-move" onPointerDown={(e) => e.stopPropagation()}>
               <Button variant="ghost" size="icon" className="h-6 w-6" onClick={toggleMaximize}>
                  {isMaximized ? <Minimize className="h-4 w-4"/> : <Maximize className="h-4 w-4"/>}
                  <span className="sr-only">{isMaximized ? 'Minimize' : 'Maximize'}</span>
               </Button>
               <Button variant="ghost" size="icon" className="h-6 w-6" onClick={stop}>
                    <X className="h-4 w-4"/>
                    <span className="sr-only">Close Player</span>
                </Button>
            </div>
            
            <CardContent className="p-4 flex flex-col gap-2 relative flex-grow">
                {/* Video Player - Rendered on top of the controls */}
                <div className={cn("w-full aspect-video bg-black rounded-md flex-shrink-0", isVideo ? "block" : "hidden")}>
                    <video
                      ref={videoPlayerRef}
                      className="w-full h-full object-contain"
                      playsInline
                    />
                </div>

                <div className="flex items-center gap-4 w-full mt-auto">
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
                </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
