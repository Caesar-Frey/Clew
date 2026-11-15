import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { browseSections, type BrowseFilter } from '@/lib/browse';
import { useData } from '@/state/data';
import { Room, SpineChip, T } from '@/ui/components';
import { usePalette } from '@/ui/theme';

/** Every thing A–Z, optionally only those in one place (or with no place). */
export default function BrowseScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { items, index } = useData();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<BrowseFilter>(params.filter === 'none' ? { kind: 'none' } : { kind: 'all' });
  const sections = useMemo(() => browseSections(items, index, filter), [items, index, filter]);
  const roots = index.children.get(null) ?? [];
  const unplaced = items.some((i) => i.locationId === null);
  const count = sections.reduce((n, s) => n + s.data.length, 0);
  const same = (f: BrowseFilter) => f.kind === filter.kind && (f.kind !== 'in' || (filter.kind === 'in' && f.id === filter.id));

  return (
    <Room>
      <SectionList
        sections={sections}
        keyExtractor={(i) => i.id}
        stickySectionHeadersEnabled
        initialNumToRender={30}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 32 }}
        ListHeaderComponent={
          <View style={{ gap: 10, paddingTop: 12, paddingBottom: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 6 }}>
              <SpineChip label="Everywhere" selected={same({ kind: 'all' })} onPress={() => setFilter({ kind: 'all' })} />
              {roots.map((r) => (
                <SpineChip
                  key={r.id}
                  label={r.name}
                  selected={same({ kind: 'in', id: r.id })}
                  onPress={() => setFilter({ kind: 'in', id: r.id })}
                />
              ))}
              {unplaced && <SpineChip label="No place yet" selected={same({ kind: 'none' })} onPress={() => setFilter({ kind: 'none' })} />}
            </ScrollView>
            <T variant="small" color={p.inkSoft}>
              {count} {count === 1 ? 'thing' : 'things'}
            </T>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={[styles.letter, { backgroundColor: p.room, borderBottomColor: p.inkFaint }]} accessibilityRole="header">
            <T variant="label" color={p.headRule}>
              {section.title}
            </T>
          </View>
        )}
        renderItem={({ item }) => {
          const place = index.pathString(item.locationId);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name}. ${item.activeLoan ? `Lent to ${item.activeLoan.person}` : place ? `In ${place}` : 'No place yet'}`}
              onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
              style={({ pressed }) => [styles.row, { borderBottomColor: p.rule, opacity: pressed ? 0.6 : 1 }]}
            >
              <T variant="body" numberOfLines={1}>
                {item.name}
              </T>
              <T variant="small" color={item.activeLoan ? p.leatherText : place ? p.inkSoft : p.inkFaint} numberOfLines={1}>
                {item.activeLoan ? `With ${item.activeLoan.person}` : place || 'No place yet'}
              </T>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <T variant="italic" color={p.inkSoft} style={{ textAlign: 'center', paddingVertical: 32 }}>
            Nothing here yet.
          </T>
        }
      />
    </Room>
  );
}

const styles = StyleSheet.create({
  letter: { paddingTop: 14, paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { minHeight: 56, justifyContent: 'center', gap: 2, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
