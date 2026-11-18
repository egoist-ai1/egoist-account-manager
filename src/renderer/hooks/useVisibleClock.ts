import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let now = Math.floor(Date.now() / 1000);
let timer: number | null = null;

function update(): void {
  now = Math.floor(Date.now() / 1000);
  listeners.forEach((listener) => listener());
}

function visibility(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  if (listeners.size && document.visibilityState === "visible") {
    update();
    timer = window.setInterval(update, 15_000);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", visibility);
    visibility();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      document.removeEventListener("visibilitychange", visibility);
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    }
  };
}

/** One clock per visible renderer; hidden windows perform no interval work. */
export function useVisibleClock(): number {
  return useSyncExternalStore(subscribe, () => now);
}
