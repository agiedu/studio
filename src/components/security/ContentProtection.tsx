
"use client";

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export function ContentProtection() {
  const pathname = usePathname();

  // Effect to prevent right-clicking, text selection, and copying
  useEffect(() => {
    // The following lines that prevent copy and context menu have been removed
    // to re-enable this functionality as requested.
    // const handleContextmenu = (e: MouseEvent) => {
    //   e.preventDefault();
    // };
    // const handleCopy = (e: ClipboardEvent) => {
    //   e.preventDefault();
    // };

    // document.addEventListener('contextmenu', handleContextmenu);
    // document.addEventListener('copy', handleCopy);

    // The following lines that disable text selection have been removed.
    // document.body.style.userSelect = 'none';
    // document.body.style.webkitUserSelect = 'none'; // For Safari

    return () => {
      // document.removeEventListener('contextmenu', handleContextmenu);
      // document.removeEventListener('copy', handleCopy);
      
      // The style cleanup is no longer necessary as the styles are not applied.
      // document.body.style.userSelect = 'auto';
      // document.body.style.webkitUserSelect = 'auto';
    };
  }, [pathname]); // Re-apply if path changes, though it's a global effect

  // Effect to prevent being loaded in an iframe
  useEffect(() => {
    // This is a client-side attempt to break out of an iframe.
    // The most effective protection is the 'Content-Security-Policy' header set by the server,
    // but this provides a fallback for client-rendered pages.
    if (typeof window !== 'undefined' && window.self !== window.top) {
      // If the page is in an iframe, redirect the top-level window to this page.
      // This effectively "breaks out" of the frame.
      try {
        window.top.location.replace(window.self.location.href);
      } catch (e) {
        console.warn("Could not break out of iframe due to cross-origin restrictions.");
      }
    }
  }, [pathname]);

  return null; // This component does not render anything
}
