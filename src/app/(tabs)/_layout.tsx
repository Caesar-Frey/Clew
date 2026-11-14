import { Tabs } from 'expo-router/js-tabs';
import { useState } from 'react';

import { BACKUP_DOT, CabinetTabBar } from '@/components/CabinetTabBar';
import { backupDue } from '@/lib/backupNudge';
import { LAST_BACKUP_KEY, useData } from '@/state/data';

export default function TabsLayout() {
  const { items, settings } = useData();
  const [now] = useState(Date.now);
  const out = items.filter((i) => i.activeLoan).length;
  const lastBackupAt = settings[LAST_BACKUP_KEY] ? Number(settings[LAST_BACKUP_KEY]) : null;
  const lastChangeAt = items.reduce((m, i) => Math.max(m, i.updatedAt), 0);
  const due = backupDue({ things: items.length, lastChangeAt, lastBackupAt, now });
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <CabinetTabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'Catalog' }} />
      <Tabs.Screen name="shelves" options={{ title: 'Shelves' }} />
      <Tabs.Screen name="lent" options={{ title: 'Lent out', tabBarBadge: out || undefined }} />
      <Tabs.Screen name="desk" options={{ title: 'Desk', tabBarBadge: due ? BACKUP_DOT : undefined }} />
    </Tabs>
  );
}
