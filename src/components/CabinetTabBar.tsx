import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, type ComponentType } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAnimatedValue } from '@/ui/animated';
import { CatalogIcon, CheckedOutIcon, DeskIcon, NewCardIcon, ShelvesIcon, type IconProps } from '@/ui/icons';
import { fonts, usePalette } from '@/ui/theme';
import { useReportTabBarHeight } from '@/ui/toast';

const TABS: Record<string, { label: string; Icon: ComponentType<IconProps> }> = {
  index: { label: 'Catalog', Icon: CatalogIcon },
  shelves: { label: 'Shelves', Icon: ShelvesIcon },
  lent: { label: 'Lent', Icon: CheckedOutIcon },
  desk: { label: 'Desk', Icon: DeskIcon },
};

/**
 * The tab bar is the front of a card-catalog cabinet: each tab is a drawer
 * with a brass label holder, and the open one slides out toward you. A brass
 * "new card" button sits in the middle for adding from anywhere.
 */
export function CabinetTabBar({ state, emitter, navigateToTab, insets, descriptors }: BottomTabBarProps) {
  const p = usePalette();
  const wood = p.scheme === 'dark' ? '#2B1B12' : '#5B3A24';
  const woodEdge = p.scheme === 'dark' ? '#1A100A' : '#3F2716';
  const left = state.routes.slice(0, 2);
  const right = state.routes.slice(2);
  const reportHeight = useReportTabBarHeight();

  const renderDrawer = (route: (typeof state.routes)[number]) => {
    const index = state.routes.indexOf(route);
    const tab = TABS[route.name] ?? { label: route.name, Icon: CatalogIcon };
    const focused = index === state.index;
    const badge = descriptors[route.key]?.options.tabBarBadge;
    return (
      <Drawer
        key={route.key}
        label={tab.label}
        Icon={tab.Icon}
        focused={focused}
        badge={typeof badge === 'number' || typeof badge === 'string' ? String(badge) : undefined}
        onPress={() => {
          const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            Haptics.selectionAsync().catch(() => {});
            navigateToTab(route.key);
          }
        }}
      />
    );
  };

  return (
    <View
      onLayout={(e) => reportHeight?.(e.nativeEvent.layout.height)}
      style={[styles.cabinet, { backgroundColor: wood, borderTopColor: woodEdge, paddingBottom: Math.max(insets.bottom, 8) }]}
    >
      <View style={[styles.molding, { backgroundColor: p.brassDark }]} />
      <View style={styles.row}>
        {left.map(renderDrawer)}
        <NewCardButton />
        {right.map(renderDrawer)}
      </View>
    </View>
  );
}

function Drawer({
  label,
  Icon,
  focused,
  badge,
  onPress,
}: {
  label: string;
  Icon: ComponentType<IconProps>;
  focused: boolean;
  badge?: string;
  onPress: () => void;
}) {
  const p = usePalette();
  const out = useAnimatedValue(focused ? 1 : 0);
  useEffect(() => {
    Animated.spring(out, { toValue: focused ? 1 : 0, useNativeDriver: true, speed: 18, bounciness: 9 }).start();
  }, [focused, out]);
  const face = p.scheme === 'dark' ? '#3A2618' : '#7A5034';
  const faceOpen = p.scheme === 'dark' ? '#4A3020' : '#8C5D3D';
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      onPress={onPress}
      style={styles.slot}
    >
      <Animated.View
        style={[
          styles.drawer,
          {
            backgroundColor: focused ? faceOpen : face,
            transform: [
              { translateY: Animated.multiply(out, -6) },
              { scale: Animated.add(1, Animated.multiply(out, 0.04)) },
            ],
            shadowOpacity: focused ? 0.45 : 0.15,
          },
        ]}
      >
        <View style={[styles.holder, { borderColor: p.brass, backgroundColor: '#F6EEDB' }]}>
          {/* Scales with the system text size (capped so the cabinet still fits). */}
          <Text numberOfLines={2} maxFontSizeMultiplier={1.6} style={[styles.holderText, { color: '#2A1F17' }]}>
            {label}
          </Text>
        </View>
        <Icon size={20} color={focused ? p.brassLight : p.brass} accent={focused ? 'rgba(226,197,142,0.25)' : undefined} />
        <View style={[styles.pull, { backgroundColor: p.brass }]} />
        {badge ? (
          <View style={[styles.badge, { backgroundColor: p.stamp }]}>
            <Text maxFontSizeMultiplier={1.4} style={styles.badgeText}>
              {badge}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

function NewCardButton() {
  const p = usePalette();
  const scale = useAnimatedValue(1);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add a thing"
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        router.push('/add');
      }}
      onPressIn={() => Animated.spring(scale, { toValue: 0.9, useNativeDriver: true, speed: 50 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 12 }).start()}
      style={styles.slot}
    >
      <Animated.View
        style={[
          styles.newCard,
          { backgroundColor: p.brass, borderColor: p.brassLight, shadowColor: '#000', transform: [{ scale }] },
        ]}
      >
        <View style={[styles.newCardRing, { borderColor: p.brassDark }]} />
        <NewCardIcon size={28} color="#2A1F17" />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cabinet: { borderTopWidth: 2, paddingTop: 10 },
  molding: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, opacity: 0.6 },
  row: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 6 },
  slot: { flex: 1, alignItems: 'center' },
  drawer: {
    width: '92%',
    borderRadius: 4,
    paddingTop: 6,
    paddingBottom: 6,
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 4,
    elevation: 3,
  },
  holder: { borderWidth: 1.5, borderRadius: 2, paddingHorizontal: 4, paddingVertical: 1, maxWidth: '92%' },
  holderText: { fontFamily: fonts.typedBold, fontSize: 11, letterSpacing: 0.3, textTransform: 'uppercase', textAlign: 'center' },
  pull: { width: 18, height: 4, borderRadius: 2 },
  badge: {
    position: 'absolute',
    top: -10,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFF4E6', fontFamily: fonts.typedBold, fontSize: 10 },
  newCard: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -26,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
  },
  newCardRing: { position: 'absolute', top: 4, left: 4, right: 4, bottom: 4, borderRadius: 26, borderWidth: 1 },
});
