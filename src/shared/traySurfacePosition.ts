export interface SurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SurfacePoint {
  x: number;
  y: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Positions a tray surface inside the nearest display work area for every Windows taskbar edge. */
export function calculateTraySurfacePosition(
  trayBounds: SurfaceBounds,
  popupBounds: Pick<SurfaceBounds, "width" | "height">,
  workArea: SurfaceBounds,
  gap = 10,
  inset = 8
): SurfacePoint {
  const workRight = workArea.x + workArea.width;
  const workBottom = workArea.y + workArea.height;
  const taskbarBelow = trayBounds.y >= workBottom - 2;
  const taskbarAbove = trayBounds.y + trayBounds.height <= workArea.y + 2;
  const taskbarLeft = trayBounds.x + trayBounds.width <= workArea.x + 2;
  const taskbarRight = trayBounds.x >= workRight - 2;
  let x = trayBounds.x + trayBounds.width - popupBounds.width;
  let y = trayBounds.y - popupBounds.height - gap;

  if (taskbarAbove) {
    y = trayBounds.y + trayBounds.height + gap;
  } else if (taskbarLeft) {
    x = trayBounds.x + trayBounds.width + gap;
    y = trayBounds.y + trayBounds.height - popupBounds.height;
  } else if (taskbarRight && !taskbarBelow) {
    x = trayBounds.x - popupBounds.width - gap;
    y = trayBounds.y + trayBounds.height - popupBounds.height;
  }

  return {
    x: Math.round(clamp(x, workArea.x + inset, workRight - popupBounds.width - inset)),
    y: Math.round(clamp(y, workArea.y + inset, workBottom - popupBounds.height - inset))
  };
}
