import app from '../app.json';

type PluginEntry = string | [string, Record<string, unknown>];
const plugins = app.expo.plugins as PluginEntry[];
const options = (name: string) => {
  const entry = plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);
  return Array.isArray(entry) ? entry[1] : {};
};

describe('app.json native permissions', () => {
  it('never strips the microphone permission that voice needs', () => {
    // `false` makes expo-image-picker delete NSMicrophoneUsageDescription (iOS)
    // and mark RECORD_AUDIO as removed (Android), which breaks dictation.
    for (const name of ['expo-image-picker', 'expo-speech-recognition']) {
      const mic = options(name).microphonePermission;
      expect(mic).not.toBe(false);
      if (mic !== undefined) expect(typeof mic).toBe('string');
    }
    expect(typeof options('expo-speech-recognition').microphonePermission).toBe('string');
  });
});
