import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { goBackOrHome } from '@/lib/nav';
import { BoxFingerprintCard } from '@/components/BoxFingerprintCard';
import { ItemCard } from '@/components/ItemCard';
import { callNumber } from '@/lib/format';
import { PlaceExistsError, useData } from '@/state/data';
import { useToast } from '@/ui/toast';
import { KeyboardScreen, LibraryButton, Room, SectionLabel, SpineChip, Stamp, T, TypedInput } from '@/ui/components';
import { BinIcon, NewCardIcon, PencilIcon } from '@/ui/icons';
import { usePalette } from '@/ui/theme';

export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { items, index, actions } = useData();
  const place = id ? index.byId.get(id) : undefined;
  const [mode, setMode] = useState<'view' | 'rename' | 'inside'>('view');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const here = useMemo(() => items.filter((i) => i.locationId === id), [items, id]);
  const nestedCount = useMemo(() => {
    if (!id) return 0;
    const ids = index.subtreeIds(id);
    ids.delete(id);
    return items.filter((i) => i.locationId && ids.has(i.locationId)).length;
  }, [items, index, id]);

  if (!place || !id) {
    return (
      <Room style={styles.center}>
        <Stamp text="Removed" color={p.inkSoft} animate={false} />
      </Room>
    );
  }

  const path = index.pathNames(id);
  const placeText = index.pathString(id);
  const kids = index.children.get(id) ?? [];

  const submit = async () => {
    if (busy) return;
    if (!text.trim()) {
      setError(mode === 'rename' ? 'Type a new name.' : 'Type a place name.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'rename') await actions.renamePlace(id, text);
      else await actions.addPlace(text, id);
      setMode('view');
      setError(null);
    } catch (e) {
      if (e instanceof PlaceExistsError) {
        setMode('view');
        setError(null);
        toast({ message: e.message });
        router.push({ pathname: '/place/[id]', params: { id: e.id } });
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    Alert.alert(
      `Remove “${place.name}”?`,
      place.parentId
        ? `Everything inside moves up to “${index.byId.get(place.parentId)?.name}”. Nothing is deleted.`
        : 'Everything inside stays in your catalog. Things directly here become unshelved.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            goBackOrHome();
            await actions
              .deletePlace(id)
              .catch((e: unknown) => Alert.alert("Couldn't remove it", e instanceof Error ? e.message : String(e)));
          },
        },
      ],
    );

  return (
    <Room>
      <Stack.Screen options={{ title: place.name }} />
      <KeyboardScreen>
        <FlatList
          data={here}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 32, gap: 16 }}
          renderItem={({ item, index: i }) => <ItemCard item={item} place={placeText} enterIndex={i < 12 ? i : undefined} />}
          ListHeaderComponent={
            <View style={{ gap: 16 }}>
              <View style={{ gap: 4 }}>
                <T variant="small" color={p.headRule} style={{ letterSpacing: 1.5 }}>
                  {callNumber(path)}
                </T>
                <View style={styles.crumbs}>
                  {path.map((n, i) => {
                    const ancestorId = ancestorAt(index, id, path.length - 1 - i);
                    const last = i === path.length - 1;
                    return (
                      <View key={i} style={styles.crumb}>
                        {i > 0 && <T variant="typed" color={p.brass}> › </T>}
                        <Pressable
                          disabled={last || !ancestorId}
                          onPress={() => ancestorId && router.push({ pathname: '/place/[id]', params: { id: ancestorId } })}
                        >
                          <T variant="typed" color={last ? p.ink : p.leatherText}>
                            {n}
                          </T>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
                <T variant="small">
                  {here.length} here{nestedCount ? ` · ${nestedCount} in nested places` : ''}
                </T>
              </View>

              <View style={styles.row}>
                <LibraryButton
                  style={{ flex: 1 }}
                  label="Add a thing here"
                  icon={(c) => <NewCardIcon size={20} color={c} />}
                  onPress={() => router.push({ pathname: '/add', params: { placeId: id } })}
                />
              </View>

              {mode !== 'view' ? (
                <View style={{ gap: 12 }}>
                  <TypedInput
                    label={mode === 'rename' ? 'New name' : `New place inside ${place.name}`}
                    value={text}
                    onChangeText={setText}
                    autoFocus
                    onSubmitEditing={submit}
                  />
                  {error && (
                    <T variant="small" color={p.stamp} accessibilityLiveRegion="polite">
                      {error}
                    </T>
                  )}
                  <View style={styles.row}>
                    <LibraryButton style={{ flex: 1 }} compact tone="ghost" label="Cancel" onPress={() => setMode('view')} />
                    <LibraryButton style={{ flex: 1 }} compact tone="lamp" label={busy ? 'Saving…' : 'Save'} disabled={busy} onPress={submit} />
                  </View>
                </View>
              ) : (
                <View style={styles.row}>
                  <LibraryButton
                    style={{ flex: 1 }}
                    compact
                    tone="ghost"
                    label="Rename"
                    icon={(c) => <PencilIcon size={16} color={c} />}
                    onPress={() => {
                      setText(place.name);
                      setMode('rename');
                    }}
                  />
                  <LibraryButton
                    style={{ flex: 1 }}
                    compact
                    tone="ghost"
                    label="+ Inside"
                    onPress={() => {
                      setText('');
                      setMode('inside');
                    }}
                  />
                  <LibraryButton compact tone="ghost" label="" accessibilityLabel={`Remove ${place.name}`} icon={(c) => <BinIcon size={18} color={c} />} onPress={remove} />
                </View>
              )}

              {kids.length > 0 && (
                <View style={{ gap: 6 }}>
                  <SectionLabel>Inside</SectionLabel>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 6 }}>
                    {kids.map((k) => (
                      <SpineChip
                        key={k.id}
                        label={k.name}
                        hint={(index.children.get(k.id)?.length ?? 0) > 0 ? `${index.children.get(k.id)!.length} inside` : undefined}
                        onPress={() => router.push({ pathname: '/place/[id]', params: { id: k.id } })}
                      />
                    ))}
                  </ScrollView>
                </View>
              )}

              <BoxFingerprintCard locationId={id} name={place.name} />

              {here.length > 0 && <SectionLabel>Here</SectionLabel>}
            </View>
          }
        />
      </KeyboardScreen>
    </Room>
  );
}

function ancestorAt(index: ReturnType<typeof useData>['index'], id: string, stepsUp: number): string | null {
  let cur = index.byId.get(id);
  for (let i = 0; i < stepsUp && cur; i++) cur = cur.parentId ? index.byId.get(cur.parentId) : undefined;
  return cur?.id ?? null;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  crumbs: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  crumb: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', gap: 10 },
});
