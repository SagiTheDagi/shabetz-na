"use client";

import { useEffect, useState } from "react";

/** null until mounted (avoids SSR flash), then the match result. */
export function useMediaQuery(query: string): boolean | null {
  const [match, setMatch] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return match;
}

/** Below Tailwind `md` (768px). */
export function useIsMobile(): boolean | null {
  return useMediaQuery("(max-width: 767px)");
}
