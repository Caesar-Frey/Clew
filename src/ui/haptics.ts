import * as Haptics from 'expo-haptics';

/** Device setting: '1' turns all haptics off (Desk › Haptics). */
export const HAPTICS_OFF_KEY = 'device.hapticsOff';

let enabled = true;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

const done = Promise.resolve();

const IMPACT = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
} as const;

/** Every buzz in the app goes through here, so the Desk switch can silence them all. */
export const haptic = {
  selection: (): Promise<void> => (enabled ? Haptics.selectionAsync() : done),
  impact: (style: keyof typeof IMPACT): Promise<void> => (enabled ? Haptics.impactAsync(IMPACT[style]) : done),
  success: (): Promise<void> => (enabled ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : done),
};
