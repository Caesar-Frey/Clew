import * as Haptics from 'expo-haptics';

import { haptic, setHapticsEnabled } from '../src/ui/haptics';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
}));

describe('haptics switch', () => {
  it('buzzes while on and stays silent while off', async () => {
    await haptic.selection();
    await haptic.impact('heavy');
    await haptic.success();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith('heavy');
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');

    setHapticsEnabled(false);
    await haptic.selection();
    await haptic.impact('light');
    await haptic.success();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  });
});
