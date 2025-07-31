
import * as React from "react"

const MOBILE_BREAKPOINT = 1024 // Adjusted for tablet support

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    // Check if window is defined (for SSR)
    if (typeof window === 'undefined') {
      setIsMobile(false);
      return;
    }
    
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    const onChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches)
    }
    
    mql.addEventListener("change", onChange)
    // Set initial state
    setIsMobile(mql.matches)
    
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
