export const motion = {
  feedback: 120,
  selection: 160,
  page: 180,
  layer: 220,
  reorder: 200,
  easing: "cubic-bezier(.2,.8,.2,1)"
} as const;

export const motionVariables = {
  "--duration-feedback": `${motion.feedback}ms`,
  "--duration-selection": `${motion.selection}ms`,
  "--duration-page": `${motion.page}ms`,
  "--duration-layer": `${motion.layer}ms`,
  "--duration-reorder": `${motion.reorder}ms`,
  "--motion-ease": motion.easing
};

export function motionAllowed(documentState: string, reducedMotion: boolean): boolean {
  return documentState === "visible" && !reducedMotion;
}

export interface MotionHandle {
  finished: Promise<unknown>;
  cancel: () => void;
}

/** One owner per surface: replacement and disposal cancel stale transitions. */
export class SurfaceMotion {
  private current: MotionHandle | null = null;

  replace(create: () => MotionHandle, allowed: boolean): void {
    this.cancel();
    if (!allowed) return;
    const next = create();
    this.current = next;
    void next.finished.catch(() => undefined).then(() => {
      if (this.current === next) this.current = null;
    });
  }

  cancel(): void {
    this.current?.cancel();
    this.current = null;
  }
}
