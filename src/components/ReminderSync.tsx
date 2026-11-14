import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { planReminders } from '@/reminders/plan';
import { askForReminders, onPermissionChanged, onReminderOpened, reminderPermission, syncReminders } from '@/reminders/scheduler';
import { createReminderSyncer } from '@/reminders/syncer';
import { useAppLock } from '@/security/lock';
import { useData } from '@/state/data';

/** Turned off from the Desk. */
export const REMINDERS_OFF_KEY = 'reminders.off';
/** Set once we've asked for notification permission, so we ask only once. */
const ASKED_KEY = 'device.remindersAsked';

/**
 * Keeps the phone's pending reminders in step with current loans. Asks for
 * notification permission the first time a loan has a due date. Re-syncs
 * when the app comes back to the foreground (time zone changes, a schedule
 * that failed half-way).
 */
interface Latest {
  items: ReturnType<typeof useData>['items'];
  settings: Record<string, string>;
  discreet: boolean;
  actions: ReturnType<typeof useData>['actions'];
}

function makeSyncer(latest: { current: Latest }) {
  return createReminderSyncer({
    plan: () => {
      const { items, settings, discreet } = latest.current;
      return settings[REMINDERS_OFF_KEY] === '1' ? [] : planReminders(items, Date.now(), discreet);
    },
    permission: reminderPermission,
    ask: askForReminders,
    asked: () => latest.current.settings[ASKED_KEY] === '1',
    markAsked: () => latest.current.actions.setSetting(ASKED_KEY, '1'),
    schedule: syncReminders,
  });
}

export function ReminderSync() {
  const { items, settings, actions } = useData();
  const { enabled: discreet } = useAppLock();
  const latest = useRef<Latest>({ items, settings, discreet, actions });
  const syncerRef = useRef<ReturnType<typeof makeSyncer> | null>(null);
  /** Only called from effects. */
  const syncer = () => (syncerRef.current ??= makeSyncer(latest));

  // A tapped reminder can arrive before the navigator exists (cold start):
  // hold it until the root navigator is ready.
  const navReady = !!useRootNavigationState()?.key;
  const nav = useRef({ ready: false, pending: null as string | null });
  useEffect(
    () =>
      onReminderOpened((id) => {
        if (nav.current.ready) router.push({ pathname: '/item/[id]', params: { id } });
        else nav.current.pending = id;
      }),
    [],
  );
  useEffect(() => {
    nav.current.ready = navReady;
    const id = nav.current.pending;
    if (navReady && id) {
      nav.current.pending = null;
      router.push({ pathname: '/item/[id]', params: { id } });
    }
  }, [navReady]);

  const off = settings[REMINDERS_OFF_KEY] === '1';
  useEffect(() => {
    latest.current = { items, settings, discreet, actions };
  });
  useEffect(() => {
    syncer().run().catch(() => {});
  }, [items, off, discreet]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncer().run(true).catch(() => {});
    });
    const unsubscribe = onPermissionChanged(() => syncer().run(true).catch(() => {}));
    return () => {
      sub.remove();
      unsubscribe();
    };
  }, []);

  return null;
}
