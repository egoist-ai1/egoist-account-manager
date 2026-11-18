import { useLayoutEffect, useEffect, useRef, type RefObject } from "react";
import { motion, motionAllowed, motionVariables, SurfaceMotion } from "../motion";

export function useMotionEnvironment(): void {
  useEffect(() => {
    const root = document.documentElement;
    const previous = Object.keys(motionVariables).map((name) => [name, root.style.getPropertyValue(name)]);
    for (const [name, value] of Object.entries(motionVariables)) root.style.setProperty(name, value);
    const onVisibility = () => {
      if (document.visibilityState === "visible") delete root.dataset.motionPaused;
      else root.dataset.motionPaused = "true";
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      delete root.dataset.motionPaused;
      for (const [name, value] of previous) {
        if (value) root.style.setProperty(name, value);
        else root.style.removeProperty(name);
      }
    };
  }, []);
}

export function useSurfaceMotion<T extends HTMLElement>(ref: RefObject<T | null>, key: string): void {
  const owner = useRef(new SurfaceMotion());
  useLayoutEffect(() => {
    const element = ref.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => owner.current.cancel();
    if (element && typeof element.animate === "function") {
      owner.current.replace(() => element.animate([{ opacity: .55 }, { opacity: 1 }], {
        duration: motion.page, easing: motion.easing
      }), motionAllowed(document.visibilityState, reduced.matches));
    }
    document.addEventListener("visibilitychange", cancel);
    reduced.addEventListener("change", cancel);
    return () => {
      cancel();
      document.removeEventListener("visibilitychange", cancel);
      reduced.removeEventListener("change", cancel);
    };
  }, [key, ref]);
}

/** Animate retained, visible rows only when order changes, never on clock ticks. */
export function useListMotion<T extends HTMLElement>(ref: RefObject<T | null>, key: string): void {
  const positions = useRef(new Map<string, number>());
  const running = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => { running.current.forEach((animation) => animation.cancel()); running.current = []; };
    const bounds = element.getBoundingClientRect();
    const visible = [...element.querySelectorAll<HTMLElement>("[data-profile-id]")].map((row) => ({
      row, id: row.dataset.profileId!, top: row.getBoundingClientRect().top
    })).filter(({ top }) => top >= bounds.top - 100 && top < bounds.bottom).slice(0, 24);
    const next = new Map(visible.map(({ id, top }) => [id, top]));
    const moves = visible.map(({ row, id, top }) => ({ row, offset: (positions.current.get(id) ?? top) - top }));
    positions.current = next;
    cancel();
    if (motionAllowed(document.visibilityState, reduced.matches)) {
      for (const { row, offset } of moves) {
        if (!offset || Math.abs(offset) > bounds.height || typeof row.animate !== "function") continue;
        const animation = row.animate([{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }], {
          duration: motion.reorder, easing: motion.easing
        });
        running.current.push(animation);
        void animation.finished.catch(() => undefined);
      }
    }
    document.addEventListener("visibilitychange", cancel);
    reduced.addEventListener("change", cancel);
    return () => { cancel(); document.removeEventListener("visibilitychange", cancel); reduced.removeEventListener("change", cancel); };
  }, [key, ref]);
}
