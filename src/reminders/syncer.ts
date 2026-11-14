import type { PlannedReminder } from './plan';
import type { ReminderPermission } from './scheduler';

export interface SyncerDeps {
  /** The plan as of right now (reads the latest items and settings). */
  plan: () => PlannedReminder[];
  permission: () => Promise<ReminderPermission>;
  ask: () => Promise<boolean>;
  /** True once the user has been asked; never ask twice on our own. */
  asked: () => boolean;
  markAsked: () => Promise<void>;
  schedule: (plan: PlannedReminder[]) => Promise<void>;
}

/**
 * Keeps scheduled reminders in step with the plan. Runs never overlap: a
 * request while one is running makes it go round once more with the latest
 * plan, so a settings write in the middle (which re-renders and re-plans)
 * can't cancel the first schedule after permission is granted.
 */
export function createReminderSyncer(deps: SyncerDeps) {
  let last: string | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let forceNext = false;

  async function loop(): Promise<void> {
    do {
      again = false;
      const force = forceNext;
      forceNext = false;
      const plan = deps.plan();
      const signature = JSON.stringify(plan);
      if (!force && signature === last) continue;
      let permission = await deps.permission();
      if (plan.length && permission === 'undetermined' && !deps.asked()) {
        permission = (await deps.ask()) ? 'granted' : 'denied';
        // Recorded only once the prompt has been answered.
        await deps.markAsked();
      }
      if (permission === 'granted' || plan.length === 0) {
        try {
          await deps.schedule(plan);
          last = signature;
        } catch {
          // Leave `last` alone so the next run (e.g. on foreground) retries.
          last = null;
        }
      }
    } while (again);
  }

  return {
    /** `force` re-schedules even if the plan looks unchanged (foreground, time zone change). */
    run(force = false): Promise<void> {
      if (force) forceNext = true;
      if (running) {
        again = true;
        return running;
      }
      running = loop().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
