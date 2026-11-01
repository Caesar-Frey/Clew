import { router } from 'expo-router';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMeaningSearch } from '@/ai/assistant';
import { ItemCard } from '@/components/ItemCard';
import { VoiceButton } from '@/components/VoiceButton';
import type { Item, Location } from '@/db/types';
import { buildCatalog } from '@/search/catalog';
import { useData } from '@/state/data';
import { LibraryButton, Room, SectionLabel, SpineChip, Stamp, T } from '@/ui/components';
import { CloseIcon, LoupeIcon } from '@/ui/icons';
import { fonts, usePalette } from '@/ui/theme';
import { spokenQuery } from '@/voice/parse';
import { useDictation } from '@/voice/useDictation';

export default function CatalogScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { items, locations, index, boxes } = useData();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const input = useRef<TextInputInstance>(null);
  const dictation = useDictation((text) => setQuery(spokenQuery(text)));
  const listening = dictation.state === 'listening';

  const catalog = useMemo(() => buildCatalog(items, locations, index, boxes), [items, locations, index, boxes]);
  const { things, places } = useMemo(() => {
    if (!deferred.trim()) {
      return { things: [...items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40), places: [] as Location[] };
    }
    const hits = catalog.search(deferred, 80);
    const things: Item[] = [];
    const places: Location[] = [];
    for (const h of hits) {
      if (h.value.kind === 'item') things.push(h.value.item);
      else if (places.length < 6) places.push(h.value.place);
    }
    return { things, places };
  }, [catalog, deferred, items]);

  const searching = deferred.trim().length > 0;

  // Close in meaning but not in spelling: "something to cut wood" → the saw.
  const meaningHits = useMeaningSearch(deferred);
  const maybe = useMemo(() => {
    if (!meaningHits.length) return [];
    const shown = new Set(things.map((i) => i.id));
    const byId = new Map(items.map((i) => [i.id, i]));
    return meaningHits.filter((h) => !shown.has(h.id)).flatMap((h) => byId.get(h.id) ?? []);
  }, [meaningHits, things, items]);

  return (
    <Room>
      <FlatList
        data={things}
        keyExtractor={(i) => i.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 18, paddingBottom: 32, gap: 12 }}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 4 }}>
            <View>
              <T variant="label" color={p.headRule}>
                The catalog · {items.length} {items.length === 1 ? 'card' : 'cards'}
              </T>
              <T variant="title">Clew</T>
            </View>
            <View style={[styles.search, { backgroundColor: p.card, borderColor: p.cardEdge, shadowColor: p.shadow }]}>
              <LoupeIcon size={22} color={p.ink} accent={p.brass} />
              <TextInput
                ref={input}
                value={query}
                onChangeText={setQuery}
                autoFocus={items.length > 0}
                placeholder={listening ? 'Listening…' : 'What are you looking for?'}
                placeholderTextColor={p.inkFaint}
                selectionColor={p.leather}
                cursorColor={p.leather}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={() => Keyboard.dismiss()}
                accessibilityLabel="Search your things and places"
                style={[styles.searchInput, { color: p.ink }]}
              />
              {query ? (
                <Pressable
                  hitSlop={12}
                  accessibilityLabel="Clear search"
                  onPress={() => {
                    setQuery('');
                    input.current?.focus();
                  }}
                >
                  <CloseIcon size={18} color={p.inkSoft} />
                </Pressable>
              ) : (
                <VoiceButton
                  size={34}
                  listening={listening}
                  accessibilityLabel="Ask out loud, like “where's my passport”"
                  onPress={() => (listening ? dictation.stop() : dictation.start(items.slice(0, 100).map((i) => i.name)))}
                />
              )}
            </View>
            {places.length > 0 && (
              <View style={{ gap: 6 }}>
                <SectionLabel>Shelves</SectionLabel>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 6 }}>
                  {places.map((pl) => (
                    <SpineChip
                      key={pl.id}
                      label={pl.name}
                      hint={index.pathNames(pl.parentId).slice(-1)[0]}
                      onPress={() => router.push({ pathname: '/place/[id]', params: { id: pl.id } })}
                    />
                  ))}
                </ScrollView>
              </View>
            )}
            {things.length > 0 && <SectionLabel>{searching ? 'Cards found' : 'Recently shelved'}</SectionLabel>}
          </View>
        }
        renderItem={({ item, index: i }) => <ItemCard item={item} enterIndex={i} />}
        ListFooterComponent={
          maybe.length > 0 ? (
            <View style={{ gap: 12, marginTop: things.length ? 12 : 0 }}>
              <SectionLabel>Might be what you mean</SectionLabel>
              {maybe.map((item, i) => (
                <ItemCard key={item.id} item={item} enterIndex={i} />
              ))}
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          items.length === 0 ? (
            <EmptyLibrary />
          ) : maybe.length > 0 ? (
            <T variant="italic" color={p.inkSoft}>
              No card spelled like “{deferred.trim()}”.
            </T>
          ) : places.length === 0 ? (
            <View style={styles.empty}>
              <Stamp text="No card" sub="in the catalog" color={p.stamp} />
              <T variant="italic" color={p.inkSoft} style={{ textAlign: 'center' }}>
                Nothing matches “{deferred.trim()}”.
              </T>
              <LibraryButton
                label={`Add “${deferred.trim()}”`}
                onPress={() => router.push({ pathname: '/add', params: { name: deferred.trim() } })}
              />
            </View>
          ) : undefined
        }
      />
    </Room>
  );
}

function EmptyLibrary() {
  const p = usePalette();
  return (
    <View style={styles.empty}>
      <Stamp text="New library" sub="est. today" color={p.lampText} />
      <T variant="heading" style={{ textAlign: 'center' }}>
        Your shelves are bare
      </T>
      <T variant="italic" color={p.inkSoft} style={{ textAlign: 'center' }}>
        Write a card for something you tend to misplace: the spare keys, the passport, the drill you lent out.
      </T>
      <LibraryButton label="Write the first card" onPress={() => router.push('/add')} />
      <LibraryButton
        label="Restore a backup"
        tone="ghost"
        onPress={() => router.push({ pathname: '/archive', params: { mode: 'restore' } })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  searchInput: { flex: 1, fontFamily: fonts.typed, fontSize: 17, paddingVertical: 14, outlineWidth: 0 },
  empty: { alignItems: 'center', gap: 16, paddingVertical: 40, paddingHorizontal: 12 },
});
