import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBoxMatcher } from '@/components/BoxScanner';
import { nestedCounts, treeRows } from '@/lib/placeTree';
import { PlaceExistsError, useData } from '@/state/data';
import { useToast } from '@/ui/toast';
import { KeyboardScreen, LibraryButton, Room, spineColor, Stamp, T, TypedInput } from '@/ui/components';
import { CameraIcon, ChevronIcon } from '@/ui/icons';
import { usePalette } from '@/ui/theme';

/** The whole places tree, expandable in place, with counts. */
export default function ShelvesScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { items, index, actions, boxes } = useData();
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { hasBoxes } = useBoxMatcher();
  const toast = useToast();

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const counts = useMemo(() => nestedCounts(items, index), [items, index]);
  const rows = useMemo(() => treeRows(index, counts, expanded), [index, counts, expanded]);
  const unplaced = items.filter((i) => !i.locationId && !i.activeLoan).length;
  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const identify = () =>
    hasBoxes
      ? router.push('/identify')
      : Alert.alert(
          'No boxes saved yet',
          'Open the place that is a box, tap “Fingerprint this box” and take a photo of it or its label. After that, point the camera at any saved box to see what is inside.',
        );

  const create = async () => {
    if (creating) return;
    if (!newPath.trim()) {
      setError('Type a place name.');
      return;
    }
    setCreating(true);
    try {
      await actions.addPlace(newPath);
      setNewPath('');
      setAdding(false);
      setError(null);
    } catch (e) {
      if (e instanceof PlaceExistsError) {
        setNewPath('');
        setAdding(false);
        setError(null);
        toast({ message: e.message });
        router.push({ pathname: '/place/[id]', params: { id: e.id } });
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Room>
      <KeyboardScreen>
        <FlatList
          data={rows}
          keyExtractor={(r) => r.place.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 18, paddingBottom: 32 }}
          ListHeaderComponent={
            <View style={{ gap: 14, marginBottom: 10 }}>
              <View>
                <T variant="label" color={p.headRule}>
                  The stacks · {index.byId.size} {index.byId.size === 1 ? 'place' : 'places'}
                </T>
                <T variant="title">Shelves</T>
              </View>
              <LibraryButton
                tone={hasBoxes ? 'lamp' : 'ghost'}
                label="Which box is this?"
                icon={(c) => <CameraIcon size={20} color={c} />}
                onPress={identify}
              />
              {!hasBoxes && index.byId.size > 0 && (
                <T variant="small" color={p.inkSoft}>
                  Save a photo of a box on its place page, then point the camera at it any time to see what is inside.
                </T>
              )}
              {rows.length === 0 && !adding && (
                <View style={styles.empty}>
                  <Stamp text="Unshelved" sub="no places yet" color={p.leatherText} />
                  <T variant="italic" color={p.inkSoft} style={{ textAlign: 'center' }}>
                    Places appear here as you add things, nested however you like: House › Garage › Blue box.
                  </T>
                </View>
              )}
            </View>
          }
          renderItem={({ item: row }) => {
            const { place, depth } = row;
            const isBox = !!boxes.get(place.id)?.fp;
            return (
              <View style={[styles.treeRow, { borderBottomColor: p.rule, paddingLeft: depth * 20 }]}>
                {depth === 0 && <View style={[styles.spineEdge, { backgroundColor: spineColor(place.name) }]} />}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={row.hasChildren ? `${row.expanded ? 'Collapse' : 'Expand'} ${place.name}` : undefined}
                  accessibilityState={row.hasChildren ? { expanded: row.expanded } : undefined}
                  disabled={!row.hasChildren}
                  onPress={() => toggle(place.id)}
                  hitSlop={8}
                  style={styles.arrow}
                >
                  {row.hasChildren && (
                    <View style={{ transform: [{ rotate: row.expanded ? '90deg' : '0deg' }] }}>
                      <ChevronIcon size={18} color={p.inkSoft} />
                    </View>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${place.name}, ${row.count} ${row.count === 1 ? 'thing' : 'things'}${isBox ? ', recognisable box' : ''}`}
                  onPress={() => router.push({ pathname: '/place/[id]', params: { id: place.id } })}
                  style={({ pressed }) => [styles.name, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <T variant={depth === 0 ? 'heading' : 'body'} numberOfLines={1} style={{ flexShrink: 1 }}>
                    {place.name}
                  </T>
                  {isBox && <CameraIcon size={15} color={p.leatherText} />}
                  <T variant="small" color={p.inkSoft} style={styles.count}>
                    {depth === 0 ? `${row.count} ${row.count === 1 ? 'thing' : 'things'}` : row.count}
                  </T>
                </Pressable>
              </View>
            );
          }}
          ListFooterComponent={
            <View style={{ gap: 14, marginTop: 10 }}>
              {unplaced > 0 && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/browse', params: { filter: 'none' } })}
                  style={[styles.treeRow, { borderBottomColor: p.rule }]}
                >
                  <View style={styles.arrow} />
                  <View style={styles.name}>
                    <T variant="italic" color={p.inkSoft} style={{ flexShrink: 1 }}>
                      No place yet
                    </T>
                    <T variant="small" color={p.inkSoft} style={styles.count}>
                      {unplaced} {unplaced === 1 ? 'thing' : 'things'}
                    </T>
                  </View>
                </Pressable>
              )}
              {adding ? (
                <View style={{ gap: 12 }}>
                  <TypedInput label="New place" value={newPath} onChangeText={setNewPath} placeholder="e.g. Attic > Suitcase" autoFocus onSubmitEditing={create} />
                  {error && (
                    <T variant="small" color={p.stamp}>
                      {error}
                    </T>
                  )}
                  <View style={styles.row}>
                    <LibraryButton style={{ flex: 1 }} compact tone="ghost" label="Cancel" onPress={() => setAdding(false)} />
                    <LibraryButton style={{ flex: 1 }} compact tone="lamp" label={creating ? 'Adding…' : 'Add place'} disabled={creating} onPress={create} />
                  </View>
                </View>
              ) : (
                <LibraryButton tone="ghost" label="+ New place" onPress={() => setAdding(true)} />
              )}
              {rows.length > 0 && (
                <T variant="small" color={p.inkFaint} style={{ textAlign: 'center' }}>
                  Tap a name to open the place; tap the arrow to see inside.
                </T>
              )}
            </View>
          }
        />
      </KeyboardScreen>
    </Room>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 16, paddingVertical: 40, paddingHorizontal: 12 },
  spineEdge: { position: 'absolute', left: -18, top: 0, bottom: 0, width: 6 },
  treeRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  arrow: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  count: { marginLeft: 'auto' },
  row: { flexDirection: 'row', gap: 10 },
});
