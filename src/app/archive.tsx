import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { checkPassphrase, peekArchive, type ArchiveSummary, type CatalogDump } from '@/backup/archive';
import { pickArchive } from '@/backup/device';
import { shortDate, stampDate } from '@/lib/format';
import { useData } from '@/state/data';
import { IndexCard, LibraryButton, Room, Stamp, T, TypedInput } from '@/ui/components';
import { usePalette } from '@/ui/theme';

/** Make an encrypted backup, or restore one (`?mode=restore`). */
export default function ArchiveScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const restoring = mode === 'restore';
  const insets = useSafeAreaInsets();
  return (
    <Room>
      <Stack.Screen options={{ title: restoring ? 'Restore a backup' : 'Make a backup' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24, gap: 18 }}>
          {restoring ? <RestoreFlow /> : <BackupFlow />}
        </ScrollView>
      </KeyboardAvoidingView>
    </Room>
  );
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function BackupFlow() {
  const p = usePalette();
  const { actions, items, locations } = useData();
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const problem = checkPassphrase(pass) ?? (again && again !== pass ? "The two passphrases don't match." : null);
  const ready = !problem && again === pass && progress === null;

  const seal = async () => {
    setError(null);
    setProgress(0);
    try {
      await actions.exportArchive(pass, setProgress);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDone(Date.now());
      setPass('');
      setAgain('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setProgress(null);
    }
  };

  if (done !== null) {
    return (
      <View style={styles.doneBox}>
        <Stamp text="Archived" sub={stampDate(done)} color={p.stampReturned} />
        <T variant="italic" color={p.inkSoft} style={{ textAlign: 'center' }}>
          Keep the file somewhere other than this phone, and keep the passphrase somewhere safe too. You need both to restore.
        </T>
        <LibraryButton label="Done" tone="lamp" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <>
      <IndexCard punched ruled={false}>
        <View style={{ gap: 12 }}>
          <T variant="label" color={p.headRule}>
            Into the archive
          </T>
          <T variant="body">
            A backup is a sealed copy of your whole catalog: {items.length} {items.length === 1 ? 'thing' : 'things'},{' '}
            {locations.length} {locations.length === 1 ? 'place' : 'places'}, loans, history and photos.
          </T>
          <T variant="body">
            Save it to Files, iCloud Drive, Google Drive or a computer. It opens only with the passphrase you choose here.
          </T>
          <T variant="typed" color={p.stamp}>
            If you forget the passphrase, nobody can open the backup. Not even us.
          </T>
        </View>
      </IndexCard>

      <PassphraseField label="Passphrase" value={pass} onChange={setPass} show={show} onToggle={() => setShow((s) => !s)} />
      <PassphraseField label="Same again" value={again} onChange={setAgain} show={show} onSubmit={() => ready && seal()} />
      <T variant="small" color={pass && problem ? p.stamp : p.inkSoft}>
        {pass && problem ? problem : 'Tip: a few unrelated words make a strong passphrase that is easy to remember.'}
      </T>
      {error && (
        <T variant="typed" color={p.stamp} accessibilityLiveRegion="polite">
          {error}
        </T>
      )}
      <LibraryButton
        label={progress === null ? 'Seal and save' : `Sealing… ${Math.round(progress * 100)}%`}
        disabled={!ready}
        onPress={seal}
      />
    </>
  );
}

type Picked = { name: string; bytes: Uint8Array; createdAt: number; summary: ArchiveSummary | null };

function RestoreFlow() {
  const p = usePalette();
  const { actions, items } = useData();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CatalogDump | null>(null);

  const choose = async () => {
    setError(null);
    try {
      const file = await pickArchive();
      if (!file) return;
      const info = peekArchive(file.bytes);
      setPicked({ ...file, ...info });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const replace = async (dump: CatalogDump) => {
    try {
      await actions.restoreArchive(dump);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDone(dump);
    } catch (e) {
      setError(`Nothing was changed. ${errorText(e)}`);
    }
  };

  const open = async () => {
    if (!picked) return;
    setError(null);
    setProgress(0);
    let dump: CatalogDump;
    try {
      dump = await actions.openArchive(picked.bytes, pass, setProgress);
    } catch (e) {
      setError(errorText(e));
      return;
    } finally {
      setProgress(null);
    }
    if (items.length === 0) return replace(dump);
    Alert.alert(
      'Replace this catalog?',
      `The ${items.length} ${items.length === 1 ? 'thing' : 'things'} on this phone will be replaced by the backup. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: () => replace(dump) },
      ],
    );
  };

  if (done) {
    const n = done.tables.items?.length ?? 0;
    return (
      <View style={styles.doneBox}>
        <Stamp text="Restored" sub={`${n} ${n === 1 ? 'card' : 'cards'}`} color={p.stampReturned} />
        <LibraryButton label="To the catalog" tone="lamp" onPress={() => router.dismissTo('/')} />
      </View>
    );
  }

  return (
    <>
      <T variant="body">
        Choose a backup file made by Clew, then enter the passphrase it was sealed with. The backup replaces everything on this
        phone.
      </T>
      <LibraryButton label={picked ? 'Choose a different file' : 'Choose backup file'} tone={picked ? 'ghost' : 'leather'} onPress={choose} />
      {picked && (
        <IndexCard punched={false} ruled={false} style={{ paddingBottom: 16 }}>
          <View style={{ gap: 4 }}>
            <T variant="label">Backup</T>
            <T variant="heading" numberOfLines={2}>
              {picked.name}
            </T>
            <T variant="small">
              Made {shortDate(picked.createdAt)}
              {picked.summary
                ? ` · ${picked.summary.items} things · ${picked.summary.places} places${picked.summary.photos ? ` · ${picked.summary.photos} photos` : ''}`
                : ''}
            </T>
          </View>
        </IndexCard>
      )}
      {picked && (
        <>
          <PassphraseField
            label="Passphrase"
            value={pass}
            onChange={setPass}
            show={show}
            onToggle={() => setShow((s) => !s)}
            onSubmit={() => pass && open()}
            autoFocus
          />
          <LibraryButton
            label={progress === null ? 'Open and restore' : `Opening… ${Math.round(progress * 100)}%`}
            tone="lamp"
            disabled={!pass || progress !== null}
            onPress={open}
          />
        </>
      )}
      {error && (
        <T variant="typed" color={p.stamp} accessibilityLiveRegion="polite">
          {error}
        </T>
      )}
    </>
  );
}

function PassphraseField({
  label,
  value,
  onChange,
  show,
  onToggle,
  onSubmit,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle?: () => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  const p = usePalette();
  return (
    <View>
      <TypedInput
        label={label}
        value={value}
        onChangeText={onChange}
        secureTextEntry={!show}
        autoCapitalize="none"
        autoComplete="off"
        textContentType="none"
        autoFocus={autoFocus}
        onSubmitEditing={onSubmit}
        style={onToggle ? { paddingRight: 56 } : undefined}
      />
      {onToggle && (
        <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide passphrase' : 'Show passphrase'} onPress={onToggle} hitSlop={10} style={styles.toggle}>
          <T variant="label" color={p.leatherText}>
            {show ? 'Hide' : 'Show'}
          </T>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  doneBox: { alignItems: 'center', gap: 18, paddingVertical: 32 },
  toggle: { position: 'absolute', right: 0, bottom: 12 },
});
