import type { PlannedReminder } from './plan';

/** The browser design preview doesn't schedule anything. */
export type ReminderPermission = 'granted' | 'denied' | 'undetermined';
export const reminderPermission = async (): Promise<ReminderPermission> => 'denied';
export const askForReminders = async () => false;
export const syncReminders = async (_plan: PlannedReminder[]) => {};
export const onReminderOpened = (_cb: (itemId: string) => void) => () => {};
export const onPermissionChanged = (_cb: () => void) => () => {};
