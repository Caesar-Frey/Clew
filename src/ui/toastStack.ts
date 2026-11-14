/** How many notices can be up at once; older ones keep their Undo. */
export const MAX_TOASTS = 3;
/** How long a notice stays up (long enough to read it and reach Undo). */
export const SHOW_MS = 8000;

/** Adds a notice, dropping the oldest beyond `max`. Newest is last. */
export function pushToast<T>(
  list: readonly T[],
  toast: T,
  max = MAX_TOASTS,
): T[] {
  const next = [...list, toast];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Runs an undo; returns false (and never throws) if it failed. */
export async function runUndo(
  undo: () => Promise<unknown> | void,
): Promise<boolean> {
  try {
    await undo();
    return true;
  } catch {
    return false;
  }
}

const TAB_PATHS = new Set(["/", "/shelves", "/lent", "/desk"]);

/** Distance from the bottom safe area: clears the tab bar on tab screens. */
export function toastLift(
  pathname: string,
  tabBarHeight: number,
  insetBottom: number,
): number {
  return TAB_PATHS.has(pathname)
    ? Math.max(tabBarHeight, insetBottom) + 12
    : insetBottom + 16;
}
