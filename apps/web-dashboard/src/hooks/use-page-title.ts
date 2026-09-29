import { useEffect } from "react";

const SUFFIX = "PromptGuard";

/** Sets document.title for the current route and restores it on unmount. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · ${SUFFIX}` : SUFFIX;

    return () => {
      document.title = previous;
    };
  }, [title]);
}
