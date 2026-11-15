const DAY = 24 * 60 * 60 * 1000;
/** Suggest a fresh backup after this long, if anything changed since. */
export const BACKUP_STALE_MS = 30 * DAY;
/** With no backup at all, the Desk tab gets a dot once there are this many things. */
export const DOT_AFTER_THINGS = 10;
/** Set once the user dismisses the one-time "make a backup" card. */
export const BACKUP_NUDGE_DISMISSED_KEY = 'device.backupNudgeDismissed';

/** The Desk tab dot: a backup is overdue. */
export function backupDue(o: { things: number; lastChangeAt: number; lastBackupAt: number | null; now: number }): boolean {
  if (o.lastBackupAt === null) return o.things >= DOT_AFTER_THINGS;
  return o.now - o.lastBackupAt > BACKUP_STALE_MS && o.lastChangeAt > o.lastBackupAt;
}

/** The one-time card after the first save, until a backup exists or it is dismissed. */
export function showFirstBackupCard(o: { things: number; lastBackupAt: number | null; dismissed: boolean }): boolean {
  return o.things > 0 && o.lastBackupAt === null && !o.dismissed;
}
