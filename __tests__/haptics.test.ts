const mockSelection = jest.fn(() => Promise.resolve());
const mockImpact = jest.fn(() => Promise.resolve());
const mockNotify = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({
  selectionAsync: mockSelection,
  impactAsync: mockImpact,
  notificationAsync: mockNotify,
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
}));

import { haptic, setHapticsEnabled } from '../src/ui/haptics';

describe('haptics switch', () => {
  it('buzzes while on and stays silent while off', async () => {
    await haptic.selection();
    await haptic.impact('heavy');
    await haptic.success();
    expect(mockSelection).toHaveBeenCalledTimes(1);
    expect(mockImpact).toHaveBeenCalledWith('heavy');
    expect(mockNotify).toHaveBeenCalledWith('success');

    setHapticsEnabled(false);
    await haptic.selection();
    await haptic.impact('light');
    await haptic.success();
    expect(mockSelection).toHaveBeenCalledTimes(1);
    expect(mockImpact).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });
});
