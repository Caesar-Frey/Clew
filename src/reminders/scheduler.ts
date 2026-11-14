import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import type { PlannedReminder } from './plan';

const CHANNEL = 'due-dates';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type ReminderPermission = 'granted' | 'denied' | 'undetermined';

/**
 * "undetermined" means the system prompt can still be shown (including after
 * an Android "deny once"); "denied" means only Settings can change it.
 */
export async function reminderPermission(): Promise<ReminderPermission> {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  return status === 'denied' && !canAskAgain ? 'denied' : 'undetermined';
}

/**
 * Android 13+ shows no permission prompt until the app has a notification
 * channel, so the channel must exist before asking.
 */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Due dates',
    description: 'When something you lent is due back',
    importance: AndroidImportance.DEFAULT,
  });
}

const permissionListeners = new Set<() => void>();

/** Called when the user grants or refuses notifications from inside the app. */
export function onPermissionChanged(cb: () => void): () => void {
  permissionListeners.add(cb);
  return () => permissionListeners.delete(cb);
}

export async function askForReminders(): Promise<boolean> {
  await ensureChannel();
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  permissionListeners.forEach((cb) => cb());
  return status === 'granted';
}

/** Replaces every pending reminder with `plan`. Clew schedules nothing else. */
export async function syncReminders(plan: PlannedReminder[]): Promise<void> {
  await ensureChannel();
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const r of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body, data: { itemId: r.itemId } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at, channelId: CHANNEL },
    });
  }
}

/** Calls back with the item id whenever a reminder is tapped (including the one that launched the app). */
export function onReminderOpened(cb: (itemId: string) => void): () => void {
  const handle = (response: Notifications.NotificationResponse | null) => {
    const id = response?.notification.request.content.data?.itemId;
    if (typeof id === 'string') cb(id);
  };
  handle(Notifications.getLastNotificationResponse());
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
