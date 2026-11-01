import type { Item } from '../db/types';
import { startOfDay } from '../lib/format';

const DAY = 24 * 60 * 60 * 1000;
/** Reminders arrive at 9 in the morning, local time. */
const MORNING = 9 * 60 * 60 * 1000;
/** If it still isn't back, one more nudge this many days later. */
const NUDGE_AFTER_DAYS = 3;
/** iOS keeps at most 64 pending local notifications per app. */
const MAX = 60;

export interface PlannedReminder {
  /** Stable, so re-planning replaces rather than duplicates. */
  id: string;
  at: number;
  title: string;
  body: string;
  itemId: string;
}

/**
 * The reminders that should be pending for the current loans. With `discreet`
 * set (app lock on), nothing about the item or person shows on the lock
 * screen.
 */
export function planReminders(items: Item[], now: number, discreet: boolean): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  for (const item of items) {
    const loan = item.activeLoan;
    if (!loan?.dueAt) continue;
    const dueMorning = startOfDay(loan.dueAt) + MORNING;
    const nudge = dueMorning + NUDGE_AFTER_DAYS * DAY;
    const what = `“${item.name}”`;
    if (dueMorning > now) {
      out.push({
        id: `due:${loan.id}`,
        at: dueMorning,
        itemId: item.id,
        title: discreet ? 'Something is due back today' : `${what} is due back today`,
        body: discreet ? 'Open Clew to see what.' : `${loan.person} has it. Time to ask for it back?`,
      });
    }
    if (nudge > now) {
      out.push({
        id: `late:${loan.id}`,
        at: nudge,
        itemId: item.id,
        title: discreet ? 'Something is overdue' : `${what} is overdue`,
        body: discreet ? 'Open Clew to see what.' : `${loan.person} still has it. It was due ${NUDGE_AFTER_DAYS} days ago.`,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, MAX);
}
