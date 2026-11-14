import { Tabs } from 'expo-router/js-tabs';

import { CabinetTabBar } from '@/components/CabinetTabBar';
import { useData } from '@/state/data';

export default function TabsLayout() {
  const { items } = useData();
  const out = items.filter((i) => i.activeLoan).length;
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <CabinetTabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'Catalog' }} />
      <Tabs.Screen name="shelves" options={{ title: 'Shelves' }} />
      <Tabs.Screen name="lent" options={{ title: 'Lent out', tabBarBadge: out || undefined }} />
      <Tabs.Screen name="desk" options={{ title: 'Desk' }} />
    </Tabs>
  );
}
