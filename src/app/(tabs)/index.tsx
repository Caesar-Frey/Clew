import { router } from 'expo-router';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMeaningSearch } from '@/ai/assistant';
import { ItemCard } from '@/components/ItemCard';
import { VoiceButton } from '@/components/VoiceButton';
import type { Item, Location } from '@/db/types';
import { BACKUP_NUDGE_DISMISSED_KEY, showFirstBackupCard } from '@/lib/backupNudge';
import { buildCatalog } from '@/search/catalog';
import { LAST_BACKUP_KEY, useData } from '@/state/data';
import { IndexCard, LibraryButton, Room, SectionLabel, SpineChip, Stamp, T } from '@/ui/components';
import { ChevronIcon, CloseIcon, LoupeIcon } from '@/ui/icons';
import { fonts, usePalette } from '@/ui/theme';
import { spokenQuery } from '@/voice/parse';
import { useDictation } from '@/voice/useDictation';

export default function CatalogScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { items, locations, index, boxes, settings, actions } = useData();
  const firstBackup = showFirstBackupCard({
    things: items.length,
    lastBackupAt: settings[LAST_BACKUP_KEY] ? Number(settings[LAST_BACKUP_KEY]) : null,
    dismissed: settings[BACKUP_NUDGE_DISMISSED_KEY] === '1',
  });
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const input = useRef<TextInputInstance>(null);
  const dictation = useDictation((text) => setQuery(spokenQuery(text)));
  const listening = dictation.state === 'listening';

  const catalog = useMemo(() => buildCatalog(items, locations, index, boxes), [items, locations, index, boxes]);
  // Typed questions ("where's my passport") search for the thing, like spoken ones.
  const asked = useMemo(() => spokenQuery(deferred), [deferred]);
  const { things, places } = useMemo(() => {
    if (!asked) {
      return { things: [...items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20), places: [] as Location[] };
    }
    const hits = catalog.search(asked, 80);
    const things: Item[] = [];
    const places: Location[] = [];
    for (const h of hits) {
      if (h.value.kind === 'item') things.push(h.value.item);
      else if (places.length < 6) places.push(h.value.place);
    }
    return { things, places };
  }, [catalog, asked, items]);

  const searching = asked.length > 0;

  // Close in meaning but not in spelling: "something to cut wood" → the saw.
  const meaningHits = useMeaningSearch(asked);
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
                The catalog · {items.length} {items.length === 1 ? 'thing' : 'things'}
              </T>
              <T variant="title">Clew</T>
            </View>
            <View style={[styles.search, { backgroundColor: p.card, borderColor: p.cardEdge, shadowColor: p.shadow }]}>
              <LoupeIcon size={22} color={p.ink} accent={p.brass} />
              <TextInput
                ref={input}
                value={query}
                onChangeText={setQuery}
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
            {firstBackup && !searching && (
              <IndexCard punched={false} ruled={false} style={{ paddingBottom: 14 }}>
                <View style={{ gap: 10 }}>
                  <T variant="heading">Make a backup</T>
                  <T variant="body">If this phone is lost, so is your catalog. A backup is one encrypted file you keep somewhere else.</T>
                  <View style={styles.nudgeRow}>
                    <LibraryButton style={{ flex: 1 }} compact tone="lamp" label="Make a backup" onPress={() => router.push('/archive')} />
                    <LibraryButton
                      style={{ flex: 1 }}
                      compact
                      tone="ghost"
                      label="Not now"
                      onPress={() => actions.setSetting(BACKUP_NUDGE_DISMISSED_KEY, '1').catch(() => {})}
                    />
                  </View>
                </View>
              </IndexCard>
            )}
            {places.length > 0 && (
              <View style={{ gap: 6 }}>
                <SectionLabel>Places</SectionLabel>
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
            {things.length > 0 && <SectionLabel>{searching ? 'Found' : 'Recently touched'}</SectionLabel>}
          </View>
        }
        renderItem={({ item, index: i }) => <ItemCard item={item} place={index.pathString(item.locationId)} enterIndex={i} />}
        ListFooterComponent={
          <View style={{ gap: 12, marginTop: things.length ? 12 : 0 }}>
            {maybe.length > 0 && (
              <>
                <SectionLabel>Might be what you mean</SectionLabel>
                {maybe.map((item, i) => (
                  <ItemCard key={item.id} item={item} place={index.pathString(item.locationId)} enterIndex={i} />
                ))}
              </>
            )}
            {searching && things.length === 0 && (places.length > 0 || maybe.length > 0) && (
              <LibraryButton
                label={`Add “${asked}”`}
                tone="ghost"
                onPress={() => router.push({ pathname: '/add', params: { name: asked } })}
              />
            )}
            {!searching && items.length > 0 && (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/browse')}
                style={[styles.browse, { borderColor: p.rule }]}
              >
                <T variant="typed" color={p.leatherText}>
                  Browse all {items.length} things A–Z
                </T>
                <ChevronIcon size={18} color={p.leatherText} />
              </Pressable>
            )}
          </View>
        }
        ListEmptyComponent={
          items.length === 0 ? (
            <EmptyLibrary />
          ) : maybe.length > 0 ? (
            <T variant="italic" color={p.inkSoft}>
              Nothing spelled like “{asked}”.
            </T>
          ) : places.length === 0 ? (
            <View style={styles.empty}>
              <Stamp text="No card" sub="in the catalog" color={p.stamp} />
              <T variant="italic" color={p.inkSoft} style={{ textAlign: 'center' }}>
                Nothing matches “{asked}”.
              </T>
              <LibraryButton
                label={`Add “${asked}”`}
                onPress={() => router.push({ pathname: '/add', params: { name: asked } })}
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
      <View style={styles.howTo}>
        <HowTo n={1} title="Add a thing and where you put it" detail="“Passport, desk drawer.” Type it or say it." />
        <HowTo n={2} title="Find it in a second" detail="Search a few letters, even misspelt." />
        <HowTo n={3} title="Lent it? Clew remembers who has it" detail="And reminds you when it is due back." />
      </View>
      <LibraryButton label="Add your first thing" onPress={() => router.push('/add')} />
      <LibraryButton
        label="Restore a backup"
        tone="ghost"
        onPress={() => router.push({ pathname: '/archive', params: { mode: 'restore' } })}
      />
    </View>
  );
}

function HowTo({ n, title, detail }: { n: number; title: string; detail: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: 2 }}>
      <T variant="typed" color={p.ink}>
        {n} · {title}
      </T>
      <T variant="small" color={p.inkSoft}>
        {detail}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  howTo: { alignSelf: 'stretch', gap: 12, paddingVertical: 4 },
  nudgeRow: { flexDirection: 'row', gap: 10 },
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
  browse: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
});
