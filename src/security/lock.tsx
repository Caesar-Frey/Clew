import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Modal, Platform, StyleSheet, View } from 'react-native';

import { KeyholeIcon } from '../ui/icons';
import { LibraryButton, Room, T } from '../ui/components';
import { usePalette } from '../ui/theme';
import { getKeyMode, sealKey, unsealKey } from './keyVault';

// Kept in the Keychain/Keystore (not the database) so it can be read before
// anything is shown, and can't be flipped by editing app files.
// Old app name kept on purpose: renaming the key would forget the lock setting.
const LOCK_KEY = 'whereabouts.applock.v1';
const STORE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
/** Leaving the app for longer than this locks it again. */
export const RELOCK_AFTER_MS = 30_000;

export async function canUseDeviceAuth(): Promise<boolean> {
  const [hardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.getEnrolledLevelAsync(),
  ]);
  return hardware && enrolled !== LocalAuthentication.SecurityLevel.NONE;
}

/** Sealing the key needs real biometrics: the OS won't accept a passcode for it. */
export async function canSealWithBiometrics(): Promise<boolean> {
  const [hardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.getEnrolledLevelAsync(),
  ]);
  return hardware && enrolled === LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG;
}

/**
 * The JS cover below can render after the OS has already taken its
 * app-switcher snapshot, so ask the OS itself to hide the app: FLAG_SECURE on
 * Android (blank recents preview), a native blur overlay on iOS.
 */
async function setNativePrivacy(on: boolean): Promise<void> {
  if (Platform.OS === 'android') {
    if (on) await ScreenCapture.preventScreenCaptureAsync('app-lock');
    else await ScreenCapture.allowScreenCaptureAsync('app-lock');
  } else if (Platform.OS === 'ios') {
    if (on) await ScreenCapture.enableAppSwitcherProtectionAsync(1);
    else await ScreenCapture.disableAppSwitcherProtectionAsync();
  }
}

async function authenticate(prompt: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: prompt,
    cancelLabel: 'Cancel',
    // Falls back to the device passcode so nobody is locked out of their data.
    disableDeviceFallback: false,
  });
  return result.success;
}

interface LockContextValue {
  enabled: boolean;
  /** Turning the lock on or off both require proving it's you. */
  setEnabled: (on: boolean) => Promise<boolean>;
  /** The database key is released only by Face ID / fingerprint. */
  sealed: boolean;
  seal: (recoveryPassphrase: string) => Promise<void>;
  unseal: () => Promise<void>;
}

const LockContext = createContext<LockContextValue | null>(null);

export function useAppLock() {
  const ctx = useContext(LockContext);
  if (!ctx) throw new Error('useAppLock outside LockGate');
  return ctx;
}

type GateState = 'checking' | 'locked' | 'unlocked';

/**
 * Renders nothing private until the app is first unlocked, and covers the
 * screen whenever the app is not in the foreground so the app switcher
 * snapshot is blank.
 *
 * Relocking after time away puts the lock screen *over* the app instead of
 * unmounting it, so a half-written card survives. The screens underneath are
 * hidden from touch and from screen readers until unlocked again.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [sealed, setSealed] = useState(false);
  const [gate, setGate] = useState<GateState>(Platform.OS === 'web' ? 'unlocked' : 'checking');
  const [everUnlocked, setEverUnlocked] = useState(Platform.OS === 'web');
  const [covered, setCovered] = useState(false);
  const [busy, setBusy] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  const enabledRef = useRef(false);

  const unlock = useCallback(async () => {
    setBusy(true);
    try {
      if (await authenticate('Unlock Clew')) {
        setGate('unlocked');
        setEverUnlocked(true);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // The browser build is only a design preview and has no secure storage.
    if (Platform.OS === 'web') return;
    Promise.all([SecureStore.getItemAsync(LOCK_KEY, STORE_OPTS), getKeyMode()])
      .then(([v, mode]) => {
        const on = v === '1' || mode === 'sealed';
        enabledRef.current = on;
        setEnabledState(on);
        setSealed(mode === 'sealed');
        // A sealed key asks for Face ID itself when the catalog opens, so
        // don't ask twice.
        if (on && mode !== 'sealed') {
          setGate('locked');
          unlock();
        } else {
          setGate('unlocked');
          setEverUnlocked(true);
        }
      })
      // If the setting can't be read, fail closed only if it might be on.
      .catch(() => setGate('locked'));
  }, [unlock]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (!enabledRef.current) return;
      if (state === 'active') {
        setCovered(false);
        const away = backgroundedAt.current ? Date.now() - backgroundedAt.current : 0;
        backgroundedAt.current = null;
        if (away > RELOCK_AFTER_MS) {
          setGate('locked');
          unlock();
        }
      } else {
        setCovered(true);
        if (state === 'background' && backgroundedAt.current === null) backgroundedAt.current = Date.now();
      }
    });
    return () => sub.remove();
  }, [unlock]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    setNativePrivacy(enabled).catch(() => {});
  }, [enabled]);

  const setEnabled = useCallback(
    async (on: boolean) => {
      if (on && !(await canUseDeviceAuth())) return false;
      if (!on && sealed) {
        // Unsealing asks for Face ID itself, which also proves it's you.
        await unsealKey();
        setSealed(false);
      } else if (!(await authenticate(on ? 'Turn on app lock' : 'Turn off app lock'))) {
        return false;
      }
      if (on) await SecureStore.setItemAsync(LOCK_KEY, '1', STORE_OPTS);
      else await SecureStore.deleteItemAsync(LOCK_KEY, STORE_OPTS);
      enabledRef.current = on;
      setEnabledState(on);
      return true;
    },
    [sealed],
  );

  const seal = useCallback(async (recoveryPassphrase: string) => {
    await sealKey(recoveryPassphrase);
    await SecureStore.setItemAsync(LOCK_KEY, '1', STORE_OPTS);
    enabledRef.current = true;
    setEnabledState(true);
    setSealed(true);
  }, []);

  const unseal = useCallback(async () => {
    await unsealKey();
    setSealed(false);
  }, []);

  const value = useMemo(() => ({ enabled, setEnabled, sealed, seal, unseal }), [enabled, setEnabled, sealed, seal, unseal]);
  const locked = gate !== 'unlocked';
  return (
    <LockContext.Provider value={value}>
      {everUnlocked && (
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents={locked ? 'none' : 'auto'}
          accessibilityElementsHidden={locked}
          importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}
        >
          {children}
        </View>
      )}
      {/* A Modal, so it also covers screens presented as native modals
          (like a half-written card). Back does nothing while locked. */}
      <Modal visible={locked} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => {}}>
        <LockedScreen checking={gate === 'checking'} busy={busy} onUnlock={unlock} />
      </Modal>
      {!locked && covered && <PrivacyCover />}
    </LockContext.Provider>
  );
}

export function LockedScreen({
  checking,
  busy,
  onUnlock,
  children,
}: {
  checking: boolean;
  busy: boolean;
  onUnlock: () => void;
  children?: ReactNode;
}) {
  const p = usePalette();
  return (
    <Room style={styles.center}>
      <View style={[styles.door, { backgroundColor: p.lamp, borderColor: p.brass }]}>
        <KeyholeIcon size={44} color={p.brassLight} />
      </View>
      <T variant="title" style={{ textAlign: 'center' }}>
        The reading room is closed
      </T>
      <T variant="italic" color={p.inkSoft} style={{ textAlign: 'center' }}>
        Unlock to see where your things are.
      </T>
      {!checking && <LibraryButton label="Unlock" tone="lamp" disabled={busy} onPress={onUnlock} />}
      {children}
    </Room>
  );
}

function PrivacyCover() {
  const p = usePalette();
  return (
    <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: p.lampDeep }]}>
      <KeyholeIcon size={56} color={p.brass} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: 18, padding: 32 },
  door: {
    width: 104,
    height: 132,
    borderRadius: 52,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
});
