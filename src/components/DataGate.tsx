import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { openArchive, peekArchive } from '@/backup/archive';
import { nativeAead, pickArchive, randomBytes } from '@/backup/device';
import { DatabaseUnreadableError, eraseAllData, replaceUnreadableWithBackup } from '@/db/open';
import { KeyLockedError, recoverKey } from '@/security/keyVault';
import { canUseDeviceAuth, LockedScreen } from '@/security/lock';
import { useDataStatus } from '@/state/data';
import { KeyboardScreen, LibraryButton, Room, Stamp, T, TypedInput } from '@/ui/components';
import { usePalette } from '@/ui/theme';

export function DataGate({ children }: { children: ReactNode }) {
  const { status, retry } = useDataStatus();
  const p = usePalette();

  if (status.state === 'ready') return <>{children}</>;

  if (status.state === 'loading') {
    return (
      <Room style={styles.center}>
        <ActivityIndicator color={p.leather} />
        <T variant="italic" color={p.inkSoft}>
          Opening the stacks…
        </T>
      </Room>
    );
  }

  if (status.error instanceof KeyLockedError) {
    return <SealedGate error={status.error} onRetry={retry} />;
  }

  if (status.error instanceof DatabaseUnreadableError) return <UnreadableGate onDone={retry} />;

  return (
    <Room style={styles.center}>
      <Stamp text="Damaged" sub="see librarian" color={p.stamp} />
      <T variant="heading" style={{ textAlign: 'center' }} accessibilityRole="header">
        Something went wrong opening your catalog
      </T>
      <T variant="small" style={{ textAlign: 'center' }}>
        {status.error.message}
      </T>
      <View style={{ gap: 12, alignSelf: 'stretch' }}>
        <LibraryButton label="Try again" tone="lamp" onPress={retry} />
      </View>
    </Room>
  );
}

const ERASE_WORD = 'ERASE';

/**
 * The database exists but this phone has no key for it. Almost always the
 * phone was restored from another phone's backup: the catalog came across,
 * its key (kept on the old phone only) did not. Restoring a Clew backup is
 * the way back; erasing needs a typed confirmation.
 */
function UnreadableGate({ onDone }: { onDone: () => void }) {
  const p = usePalette();
  const [step, setStep] = useState<'start' | 'restore' | 'erase'>('start');
  const [picked, setPicked] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [pass, setPass] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = async () => {
    setProblem(null);
    try {
      const file = await pickArchive();
      if (!file) return;
      peekArchive(file.bytes); // Throws "not a Clew backup" early.
      setPicked(file);
      setStep('restore');
    } catch (e) {
      setProblem(errorText(e));
    }
  };

  const restore = async () => {
    if (!picked) return;
    if (!pass) {
      setProblem('Enter the passphrase this backup was made with.');
      return;
    }
    setProblem(null);
    setBusy('Opening the backup…');
    try {
      const dump = await openArchive(picked.bytes, pass, { aead: nativeAead, randomBytes });
      setBusy('Restoring…');
      await replaceUnreadableWithBackup(dump);
      onDone();
    } catch (e) {
      setProblem(`Nothing was changed. ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const erase = async () => {
    setProblem(null);
    setBusy('Erasing…');
    try {
      await eraseAllData();
      onDone();
    } catch {
      setProblem("Couldn't erase the old catalog. Restart the phone and try again.");
    } finally {
      setBusy(null);
    }
  };

  const error = problem && (
    <T variant="small" color={p.stamp} style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">
      {problem}
    </T>
  );

  if (step === 'restore' && picked) {
    return (
      <KeyboardScreen>
        <Room style={[styles.center, { alignItems: 'stretch' }]}>
          <T variant="heading" style={{ textAlign: 'center' }} accessibilityRole="header">
            Open {picked.name}
          </T>
          <T variant="small" style={{ textAlign: 'center' }}>
            Enter the passphrase this backup was made with.
          </T>
          <TypedInput label="Backup passphrase" value={pass} onChangeText={setPass} secureTextEntry autoCapitalize="none" autoFocus />
          {error}
          <LibraryButton label={busy ?? 'Restore'} tone="lamp" disabled={!!busy} onPress={restore} />
          <LibraryButton label="Choose a different file" tone="ghost" compact disabled={!!busy} onPress={choose} />
          <LibraryButton label="Back" tone="ghost" compact disabled={!!busy} onPress={() => setStep('start')} />
        </Room>
      </KeyboardScreen>
    );
  }

  if (step === 'erase') {
    return (
      <KeyboardScreen>
        <Room style={[styles.center, { alignItems: 'stretch' }]}>
          <T variant="heading" style={{ textAlign: 'center' }} accessibilityRole="header">
            Start an empty catalog?
          </T>
          <T variant="small" style={{ textAlign: 'center' }}>
            Without a backup, the things and places saved before can&apos;t be opened on this phone. If your old phone still has
            Clew, make a backup there first. Starting over deletes the locked catalog for good.
          </T>
          <TypedInput
            label={`Type ${ERASE_WORD} to confirm`}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {error}
          <LibraryButton
            label={busy ?? 'Erase and start over'}
            tone="leather"
            disabled={!!busy}
            onPress={() => (typed.trim().toUpperCase() === ERASE_WORD ? erase() : setProblem(`Type ${ERASE_WORD} first.`))}
          />
          <LibraryButton label="Back" tone="ghost" compact disabled={!!busy} onPress={() => setStep('start')} />
        </Room>
      </KeyboardScreen>
    );
  }

  return (
    <Room style={styles.center}>
      <Stamp text="Key missing" color={p.stamp} />
      <T variant="heading" style={{ textAlign: 'center' }} accessibilityRole="header">
        This catalog is locked to another phone
      </T>
      <T variant="small" style={{ textAlign: 'center' }}>
        This catalog was locked with a key that stayed on your old phone. Open a Clew backup file to get everything back.
      </T>
      {error}
      <View style={{ gap: 12, alignSelf: 'stretch' }}>
        <LibraryButton label="Restore from a backup file" tone="leather" onPress={choose} />
        <LibraryButton label="I don't have a backup" tone="ghost" onPress={() => setStep('erase')} />
        <LibraryButton label="Try again" tone="ghost" compact onPress={onDone} />
      </View>
    </Room>
  );
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The catalog key is sealed behind Face ID / fingerprint. Either unlock, or
 * (if biometrics changed and the OS dropped the key) use the recovery
 * passphrase.
 */
function SealedGate({ error, onRetry }: { error: KeyLockedError; onRetry: () => void }) {
  const p = usePalette();
  const [recovering, setRecovering] = useState(error.invalidated);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [noDeviceAuth, setNoDeviceAuth] = useState(false);

  useEffect(() => {
    // Without a passcode the phone can't release the sealed key: say so and offer the passphrase.
    canUseDeviceAuth()
      .then((ok) => setNoDeviceAuth(!ok))
      .catch(() => {});
  }, []);

  if (!recovering) {
    return (
      <LockedScreen checking={false} busy={false} onUnlock={onRetry} problem={noDeviceAuth ? 'no-device-auth' : null}>
        <LibraryButton label="Use recovery passphrase" tone="ghost" compact onPress={() => setRecovering(true)} />
      </LockedScreen>
    );
  }

  const recover = async () => {
    if (!pass) {
      setProblem('Enter your recovery passphrase.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await recoverKey(pass);
      onRetry();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardScreen>
      <Room style={[styles.center, { alignItems: 'stretch' }]}>
        <T variant="heading" style={{ textAlign: 'center' }}>
          {error.invalidated ? 'Face ID or fingerprints changed' : 'Open with your recovery passphrase'}
        </T>
        <T variant="italic" color={p.inkSoft} style={{ textAlign: 'center' }}>
          {error.invalidated
            ? 'For your safety the phone no longer releases the catalog key. Enter the recovery passphrase you chose when sealing it.'
            : 'Enter the recovery passphrase you chose when you sealed the catalog.'}
        </T>
        <TypedInput
          label="Recovery passphrase"
          value={pass}
          onChangeText={setPass}
          secureTextEntry
          autoCapitalize="none"
          autoFocus
          onSubmitEditing={() => pass && recover()}
        />
        {problem && (
          <T variant="small" color={p.stamp} style={{ textAlign: 'center' }}>
            {problem}
          </T>
        )}
        <LibraryButton label={busy ? 'Opening…' : 'Open the catalog'} tone="lamp" disabled={busy} onPress={recover} />
        {!error.invalidated && <LibraryButton label="Back" tone="ghost" compact onPress={() => setRecovering(false)} />}
        <T variant="small" style={{ textAlign: 'center' }}>
          Afterwards the key is kept the ordinary way. You can seal it again from the Desk.
        </T>
      </Room>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
});
