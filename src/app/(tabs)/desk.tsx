import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { canSealWithBiometrics, canUseDeviceAuth, RELOCK_AFTER_MS, useAppLock } from '@/security/lock';
import { MODEL_LICENCES } from '@/ai/models';
import { AssistantCard } from '@/components/AssistantCard';
import { REMINDERS_OFF_KEY } from '@/components/ReminderSync';
import { olderThan, relativeDays, shortDate } from '@/lib/format';
import { askForReminders, reminderPermission, type ReminderPermission } from '@/reminders/scheduler';
import { BACKUP_STALE_MS } from '@/lib/backupNudge';
import { LAST_BACKUP_KEY, useData } from '@/state/data';
import { IndexCard, LibraryButton, Room, SectionLabel, T } from '@/ui/components';
import { ArchiveBoxIcon, BellIcon, KeyholeIcon } from '@/ui/icons';
import { usePalette } from '@/ui/theme';

export default function DeskScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { items, locations, settings, actions } = useData();
  const [permission, setPermission] = useState<ReminderPermission | null>(null);
  // Off until notifications are actually allowed, so the switch never claims reminders that can't arrive.
  const remindersOn = settings[REMINDERS_OFF_KEY] !== '1' && permission === 'granted';

  useEffect(() => {
    const check = () => reminderPermission().then(setPermission).catch(() => setPermission('denied'));
    check();
    // Coming back from Settings may have changed it.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, []);

  const toggleReminders = async (on: boolean) => {
    if (on && permission !== 'granted') {
      const granted = permission === 'undetermined' && (await askForReminders());
      setPermission(await reminderPermission().catch(() => (granted ? 'granted' : 'denied')));
      if (!granted) {
        Alert.alert('Notifications are off', 'Allow notifications for Clew in Settings to get due-date reminders.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]);
        return;
      }
    }
    await actions.setSetting(REMINDERS_OFF_KEY, on ? '0' : '1');
  };
  const lock = useAppLock();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [canSeal, setCanSeal] = useState(false);

  useEffect(() => {
    canUseDeviceAuth().then(setAvailable).catch(() => setAvailable(false));
    canSealWithBiometrics().then(setCanSeal).catch(() => setCanSeal(false));
  }, []);

  const toggleSeal = async (on: boolean) => {
    if (on) {
      router.push('/seal');
      return;
    }
    setBusy(true);
    try {
      await lock.unseal();
    } catch (e) {
      Alert.alert("Couldn't turn off the Face ID requirement", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleLock = async (on: boolean) => {
    setBusy(true);
    try {
      const ok = await lock.setEnabled(on);
      if (!ok && on && !available) {
        Alert.alert('Set up a screen lock first', 'App lock uses your Face ID, fingerprint or device passcode.');
      }
    } catch (e) {
      Alert.alert("Couldn't change the lock", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const lent = items.filter((i) => i.activeLoan).length;
  const lastBackup = settings[LAST_BACKUP_KEY] ? Number(settings[LAST_BACKUP_KEY]) : null;
  const backupStale = items.length > 0 && olderThan(lastBackup, BACKUP_STALE_MS);

  return (
    <Room>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 18, paddingBottom: 32, gap: 16 }}>
        <View>
          <T variant="label" color={p.headRule}>
            The librarian&apos;s desk
          </T>
          <T variant="title">Desk</T>
        </View>

        <IndexCard punched={false} ruled={false} style={{ paddingBottom: 16 }}>
          <View style={styles.row}>
            <View style={[styles.badge, { backgroundColor: p.lamp }]}>
              <KeyholeIcon size={22} color={p.brassLight} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="heading">App lock</T>
              <T variant="small">
                {available === false
                  ? 'Needs Face ID, a fingerprint or a passcode on this phone.'
                  : `Ask for Face ID, fingerprint or passcode when opening, and after ${RELOCK_AFTER_MS / 1000} seconds away.`}
              </T>
            </View>
            <Switch
              value={lock.enabled}
              disabled={busy || available === null}
              onValueChange={toggleLock}
              trackColor={{ true: p.lamp, false: p.cardEdge }}
              thumbColor={p.scheme === 'dark' ? p.brassLight : '#FFFDF6'}
              ios_backgroundColor={p.cardEdge}
              accessibilityLabel="App lock"
            />
          </View>
          {lock.enabled && (canSeal || lock.sealed) && (
            <View style={[styles.row, styles.subRow, { borderTopColor: p.rule }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <T variant="body">Require Face ID to open data</T>
                <T variant="small">
                  {lock.sealed
                    ? 'The catalog key is released only by your face or fingerprint. A recovery passphrase is kept as a spare.'
                    : 'Stronger than the app lock: your data can only be decrypted after Face ID or a fingerprint.'}
                </T>
              </View>
              <Switch
                value={lock.sealed}
                disabled={busy}
                onValueChange={toggleSeal}
                trackColor={{ true: p.lamp, false: p.cardEdge }}
                thumbColor={p.scheme === 'dark' ? p.brassLight : '#FFFDF6'}
                ios_backgroundColor={p.cardEdge}
                accessibilityLabel="Require Face ID to open data"
              />
            </View>
          )}
        </IndexCard>

        <IndexCard punched={false} ruled={false} style={{ paddingBottom: 16 }}>
          <View style={styles.row}>
            <View style={[styles.badge, { backgroundColor: p.lamp }]}>
              <BellIcon size={22} color={p.brassLight} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="heading">Due-date reminders</T>
              <T variant="small">
                {permission === 'denied'
                  ? 'Notifications are off for Clew in Settings.'
                  : lock.enabled
                    ? 'A nudge at 9am on the due day. While the app is locked, they don’t say what or who.'
                    : 'A nudge at 9am on the day something is due back, and again if it’s late.'}
              </T>
            </View>
            <Switch
              value={remindersOn}
              disabled={permission === null}
              onValueChange={toggleReminders}
              trackColor={{ true: p.lamp, false: p.cardEdge }}
              thumbColor={p.scheme === 'dark' ? p.brassLight : '#FFFDF6'}
              ios_backgroundColor={p.cardEdge}
              accessibilityLabel="Due-date reminders"
            />
          </View>
        </IndexCard>

        <IndexCard punched={false} ruled={false} style={{ paddingBottom: 16 }}>
          <View style={{ gap: 14 }}>
            <View style={styles.row}>
              <View style={[styles.badge, { backgroundColor: backupStale ? p.leather : p.lamp }]}>
                <ArchiveBoxIcon size={22} color={p.brassLight} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T variant="heading">Backups</T>
                <T variant="small" color={backupStale ? p.stamp : p.inkSoft}>
                  {lastBackup === null
                    ? items.length
                      ? 'No backup yet. If this phone is lost, so is your catalog.'
                      : 'Seal a copy of your catalog with a passphrase.'
                    : `Last backup ${shortDate(lastBackup)} (${relativeDays(lastBackup)}).`}
                </T>
              </View>
            </View>
            <View style={styles.buttons}>
              <LibraryButton
                style={{ flex: 1 }}
                compact
                tone={backupStale ? 'leather' : 'lamp'}
                label="Make a backup"
                disabled={items.length === 0 && locations.length === 0}
                onPress={() => router.push('/archive')}
              />
              <LibraryButton
                style={{ flex: 1 }}
                compact
                tone="ghost"
                label="Restore"
                onPress={() => router.push({ pathname: '/archive', params: { mode: 'restore' } })}
              />
            </View>
          </View>
        </IndexCard>

        <AssistantCard />

        <IndexCard punched ruled>
          <View style={{ gap: 12 }}>
            <T variant="label" color={p.headRule} style={{ marginBottom: 14 }}>
              House rules
            </T>
            <Rule text="Everything stays on this phone. There's no account and nothing is uploaded." />
            <Rule text="Your catalog is encrypted with a key kept in the phone's secure keychain." />
            <Rule text="Backups are sealed with your passphrase before they leave the app." />
            <Rule text="No ads, no analytics, no tracking. The app only goes online to download the optional assistant, if you ask it to." />
            <Rule text="Voice uses the phone's own speech recognition. Where that would send audio to Apple or Google, Clew asks first." />
          </View>
        </IndexCard>

        <SectionLabel>Your catalog in numbers</SectionLabel>
        <View style={styles.stats}>
          <Stat label="Cards" value={items.length} />
          <Stat label="Places" value={locations.length} />
          <Stat label="Lent out" value={lent} />
        </View>

        <SectionLabel>Open-source licences</SectionLabel>
        <IndexCard punched={false} ruled={false} style={{ paddingBottom: 16 }}>
          <View style={{ gap: 10 }}>
            <T variant="small">The optional assistant downloads these open models. Each is used under its licence.</T>
            {MODEL_LICENCES.map((m) => (
              <View key={m.name} style={[styles.row, styles.licence, { borderTopColor: p.rule }]}>
                <T variant="body" style={{ flex: 1 }}>
                  {m.name}
                </T>
                <T
                  variant="small"
                  color={p.headRule}
                  accessibilityRole="link"
                  accessibilityLabel={`${m.name}, ${m.licence} licence. Opens the model page.`}
                  onPress={() => Linking.openURL(m.source)}
                  style={styles.link}
                >
                  {m.licence}
                </T>
              </View>
            ))}
          </View>
        </IndexCard>

        <T variant="small" color={p.inkFaint} style={{ textAlign: 'center', marginTop: 12 }}>
          Clew {Constants.expoConfig?.version ?? ''}
        </T>
        <T variant="small" color={p.inkFaint} style={{ textAlign: 'center', fontStyle: 'italic' }}>
          A clew is a ball of thread, like the one that led Theseus back out of the labyrinth.
        </T>
      </ScrollView>
    </Room>
  );
}


function Rule({ text }: { text: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <T variant="typed" color={p.headRule}>
        §
      </T>
      <T variant="typed" style={{ flex: 1 }}>
        {text}
      </T>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const p = usePalette();
  return (
    <View style={[styles.stat, { backgroundColor: p.card, borderColor: p.cardEdge }]}>
      <T variant="title">{value}</T>
      <T variant="label">{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', gap: 10 },
  buttons: { flexDirection: 'row', gap: 10 },
  licence: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  link: { minHeight: 44, textAlignVertical: 'center', paddingVertical: 12, textDecorationLine: 'underline' },
  subRow: { marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth },
});
