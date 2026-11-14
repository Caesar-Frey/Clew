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

describe('database backup exclusion (iOS)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { addExclusion } = require('../plugins/withDbExcludedFromBackup');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  const template: string = fs.readFileSync(`${__dirname}/fixtures/AppDelegate.swift`, 'utf8');

  it('is registered in app.json', () => {
    expect(plugins).toContain('./plugins/withDbExcludedFromBackup');
  });

  it('marks Documents/SQLite as excluded before the app starts, once', () => {
    const once = addExclusion(template);
    expect(once).toMatch(/isExcludedFromBackup = true/);
    expect(once.indexOf('isExcludedFromBackup')).toBeLessThan(once.indexOf('return super.application('));
    expect(addExclusion(once)).toBe(once);
  });

  it('fails the build loudly if the AppDelegate shape changes', () => {
    expect(() => addExclusion('class AppDelegate {}')).toThrow(/didFinishLaunchingWithOptions/);
  });
});

describe('release config', () => {
  it('runs the release plugin first so its removals win', () => {
    expect(plugins[0]).toBe('./plugins/withReleaseConfig');
  });

  it('blocks permissions Clew never uses and versions the build', () => {
    const blocked = (app.expo.android as { blockedPermissions?: string[] }).blockedPermissions ?? [];
    for (const p of ['SYSTEM_ALERT_WINDOW', 'READ_MEDIA_IMAGES', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) {
      expect(blocked).toContain(`android.permission.${p}`);
    }
    expect(app.expo.android.versionCode).toBeGreaterThan(0);
    expect(app.expo.ios.buildNumber).toBeTruthy();
    expect(app.expo.runtimeVersion).toEqual({ policy: 'appVersion' });
  });
});
