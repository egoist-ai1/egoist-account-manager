import { useLayoutEffect, type RefObject } from "react";

export interface ScrollPosition {
  top: number;
  left: number;
}

/** The caller owns the position beyond a surface's mount/unmount lifetime. */
export function usePreservedScroll<T extends HTMLElement>(ref: RefObject<T | null>, position: ScrollPosition | undefined, enabled = true): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element || !position) return;
    element.scrollTop = position.top;
    element.scrollLeft = position.left;
    const remember = () => {
      position.top = element.scrollTop;
      position.left = element.scrollLeft;
    };
    element.addEventListener("scroll", remember, { passive: true });
    return () => {
      if (element.isConnected) remember();
      element.removeEventListener("scroll", remember);
    };
  }, [enabled, position, ref]);
}
