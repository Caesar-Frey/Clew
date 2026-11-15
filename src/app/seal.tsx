import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { checkPassphrase, passphraseStrength } from '@/backup/archive';
import { SealIncompleteError } from '@/security/keyVault';
import { useAppLock } from '@/security/lock';
import { IndexCard, KeyboardScreen, LibraryButton, Room, T, TypedInput } from '@/ui/components';
import { usePalette } from '@/ui/theme';
import { useDiscardGuard } from '@/ui/useDiscardGuard';
import { haptic } from '@/ui/haptics';

/** Seal the catalog key behind Face ID / fingerprint, with a recovery passphrase. */
export default function SealScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const lock = useAppLock();
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = checkPassphrase(pass) ?? (again && again !== pass ? "The two passphrases don't match." : null);
  const ready = !problem && again === pass && !busy;
  const { leave } = useDiscardGuard(!!(pass || again) && !busy, 'Stop sealing?');

  const seal = async () => {
    if (!ready) {
      setError(problem ?? (again !== pass ? "The two passphrases don't match." : 'Type the passphrase twice.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await lock.seal(pass);
      haptic.success().catch(() => {});
      leave();
    } catch (e) {
      if (e instanceof SealIncompleteError) {
        Alert.alert('Face ID is now required', e.message);
        leave();
        return;
      }
      setError(`Nothing was changed. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Room>
      <KeyboardScreen>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24, gap: 18 }}>
          <IndexCard punched ruled={false}>
            <View style={{ gap: 12 }}>
              <T variant="label" color={p.headRule}>
                Require Face ID to open data
              </T>
              <T variant="body">
                The key that decrypts your catalog will only be released by your face or fingerprint. Even someone who can copy the
                phone&apos;s keychain can&apos;t read it.
              </T>
              <T variant="body">
                Phones throw sealed keys away when faces or fingerprints are added or changed. So choose a recovery passphrase now: it
                opens the catalog if that ever happens.
              </T>
              <T variant="typed" color={p.stamp}>
                Without Face ID, a fingerprint or this passphrase, the catalog can only come back from a backup.
              </T>
            </View>
          </IndexCard>
          <TypedInput label="Recovery passphrase" value={pass} onChangeText={setPass} secureTextEntry autoCapitalize="none" />
          <TypedInput
            label="Same again"
            value={again}
            onChangeText={setAgain}
            secureTextEntry
            autoCapitalize="none"
            onSubmitEditing={() => ready && seal()}
          />
          <T variant="small" color={pass && problem ? p.stamp : p.inkSoft}>
            {pass && problem ? problem : `${pass ? `Strength: ${passphraseStrength(pass)}. ` : ''}You can use the same passphrase as your backups.`}
          </T>
          {error && (
            <T variant="typed" color={p.stamp} accessibilityLiveRegion="polite">
              {error}
            </T>
          )}
          <LibraryButton label={busy ? 'Turning on…' : 'Require Face ID or fingerprint'} tone="lamp" disabled={busy} haptic={false} onPress={seal} />
        </ScrollView>
      </KeyboardScreen>
    </Room>
  );
}
