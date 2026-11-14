import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { goBackOrHome } from '@/lib/nav';
import { askForPhoto, PhotoPlate, useFullPhoto } from '@/components/PhotoPlate';
import { tagList, withTag } from '@/ai/text';
import { SuggestSubjects } from '@/components/SuggestSubjects';
import type { HistoryEvent } from '@/db/types';
import { callNumber, dueState, relativeDays, shortDate, stampDate } from '@/lib/format';
import { useData, useItem, useRecentPlaces } from '@/state/data';
import { BrassPlate, IndexCard, LibraryButton, Room, SectionLabel, SpineChip, Stamp, T, TypedInput } from '@/ui/components';
import { BinIcon, CameraIcon, CheckedOutIcon, PencilIcon, ReshelveIcon, StampIcon } from '@/ui/icons';
import { fonts, usePalette } from '@/ui/theme';
import { useToast } from '@/ui/toast';

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useItem(id);
  const { index, actions } = useData();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const recent = useRecentPlaces(10);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [stamp, setStamp] = useState<{ text: string; sub?: string; color: string; key: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const cover = useFullPhoto(item?.photoIds[0]);

  useEffect(() => {
    if (!item) return;
    let live = true;
    actions.itemHistory(item.id).then((h) => live && setHistory(h));
    return () => {
      live = false;
    };
  }, [actions, item]);

  if (!item) {
    return (
      <Room style={styles.center}>
        <Stack.Screen options={{ title: '' }} />
        <Stamp text="Withdrawn" color={p.inkSoft} animate={false} />
      </Room>
    );
  }

  const path = index.pathNames(item.locationId);
  const loan = item.activeLoan;
  const addPhoto = async () => {
    const ph = await askForPhoto();
    if (ph) await actions.addPhoto({ itemId: item.id }, ph).catch(showError);
  };
  const openPhoto = (photoId: string) => router.push({ pathname: '/photo/[id]', params: { id: photoId } });
  const due = loan ? dueState(loan.dueAt) : 'none';
  const moveTargets = recent
    .filter((l) => l.id !== item.locationId && !index.isWithin(item.locationId, l.id))
    .slice(0, 8);
  const flash = (text: string, color: string, sub?: string) =>
    setStamp((s) => ({ text, sub, color, key: (s?.key ?? 0) + 1 }));

  const moveTo = async (locationId: string) => {
    try {
      const moveId = await actions.moveItem(item.id, { locationId });
      if (moveId) {
        const name = index.byId.get(locationId)?.name;
        flash('Re-shelved', p.lampText, name);
        toast({ message: `Moved to ${name}`, undo: () => actions.undoMove(moveId).then(() => setStamp(null)) });
      }
    } catch (e) {
      showError(e);
    }
  };

  const markReturned = async () => {
    try {
      const loanId = await actions.returnItem(item.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      flash('Returned', p.stampReturned, todayStamp());
      if (loanId) toast({ message: `Back from ${loan?.person}`, undo: () => actions.undoReturn(loanId).then(() => setStamp(null)) });
    } catch (e) {
      showError(e);
    }
  };

  // No "are you sure?": the card can be put back from the notice.
  const withdraw = async () => {
    goBackOrHome();
    try {
      const snapshot = await actions.deleteItem(item.id);
      if (snapshot) toast({ message: `Withdrew “${item.name}”`, undo: () => actions.restoreItem(snapshot) });
    } catch (e) {
      showError(e);
    }
  };

  return (
    <Room>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <Pressable accessibilityLabel="Edit card" hitSlop={12} onPress={() => setEditing((e) => !e)}>
              <PencilIcon size={22} color={p.scheme === 'dark' ? p.brass : p.leatherText} />
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 32, gap: 20 }}>
        <IndexCard>
          <View style={{ gap: 10 }}>
            <View style={styles.cardTop}>
              <T variant="small" color={p.headRule} style={{ letterSpacing: 1.5 }}>
                {callNumber(path)}
              </T>
              <T variant="small" color={p.inkFaint}>
                Card since {shortDate(item.createdAt)}
              </T>
            </View>
            {editing ? (
              <EditFields
                initial={{ name: item.name, tags: item.tags.join(', '), notes: item.notes ?? '' }}
                photo={cover?.data ?? item.cover ?? null}
                onDone={async (v) => {
                  const tags = tagList(v.tags);
                  await actions.updateItem(item.id, { name: v.name, notes: v.notes, tags, aiTags: v.aiTags.filter((t) => tags.includes(t)) });
                  setEditing(false);
                }}
              />
            ) : (
              <>
                {item.photoIds.length > 0 && (
                  <View style={{ gap: 12, paddingVertical: 6 }}>
                    <PhotoPlate
                      base64={cover?.data ?? item.cover}
                      aspect={cover?.aspect ?? 4 / 3}
                      onPress={() => openPhoto(item.photoIds[0]!)}
                      accessibilityLabel={`Photo of ${item.name}`}
                    />
                    {item.photoIds.length > 1 && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, padding: 4 }}>
                        {item.photoIds.slice(1).map((pid, i) => (
                          <Thumb key={pid} id={pid} tilt={i % 2 ? 1.5 : -1.5} onPress={() => openPhoto(pid)} />
                        ))}
                      </ScrollView>
                    )}
                  </View>
                )}
                <T variant="title">{item.name}</T>
                {loan ? (
                  <View style={{ gap: 10 }}>
                    <Stamp
                      text={due === 'overdue' ? 'Overdue' : 'Checked out'}
                      sub={loan.dueAt ? `Due ${stampDate(loan.dueAt)}` : `to ${loan.person}`}
                      color={due === 'overdue' ? p.stamp : p.leatherText}
                      animate={false}
                    />
                    <T variant="body">
                      With <T variant="heading">{loan.person}</T> since {shortDate(loan.lentAt)}
                      {loan.dueAt ? `, due ${relativeDays(loan.dueAt)}` : ''}.
                    </T>
                  </View>
                ) : path.length ? (
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`In ${path.join(', ')}. Open shelf`}
                    onPress={() => router.push({ pathname: '/place/[id]', params: { id: item.locationId! } })}
                    style={{ gap: 6 }}
                  >
                    <T variant="label">Shelved at</T>
                    <View style={styles.pathWrap}>
                      {path.map((n, i) => (
                        <View key={i} style={styles.pathPart}>
                          {i > 0 && <T variant="heading" color={p.brass}> › </T>}
                          <T variant="heading" color={i === path.length - 1 ? p.ink : p.inkSoft}>
                            {n}
                          </T>
                        </View>
                      ))}
                    </View>
                  </Pressable>
                ) : (
                  <T variant="italic" color={p.inkSoft}>
                    Not shelved yet.
                  </T>
                )}
                {item.tags.length > 0 && (
                  <View style={styles.tags}>
                    {item.tags.map((t) => (
                      <BrassPlate key={t}>{t}</BrassPlate>
                    ))}
                  </View>
                )}
                {item.notes ? <T variant="italic">{item.notes}</T> : null}
                <Pressable onPress={addPhoto} accessibilityRole="button" hitSlop={8} style={styles.addPhoto}>
                  <CameraIcon size={16} color={p.leatherText} />
                  <T variant="small" color={p.leatherText}>
                    {item.photoIds.length ? 'Add another photo' : 'Add a photo'}
                  </T>
                </Pressable>
              </>
            )}
          </View>
        </IndexCard>

        {stamp && (
          <View key={stamp.key} style={styles.center}>
            <Stamp text={stamp.text} sub={stamp.sub} color={stamp.color} />
          </View>
        )}

        {loan ? (
          <View style={{ gap: 10 }}>
            <LibraryButton label="It's back" tone="lamp" icon={(c) => <StampIcon size={20} color={c} />} onPress={markReturned} />
            <LibraryButton
              label="Change due date"
              tone="ghost"
              onPress={() => router.push({ pathname: '/lend/[id]', params: { id: item.id } })}
            />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <SectionLabel>Moved it? Tap its new shelf</SectionLabel>
            {moveTargets.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 6 }}>
                {moveTargets.map((l) => (
                  <SpineChip
                    key={l.id}
                    label={l.name}
                    hint={index.pathNames(l.parentId).slice(-1)[0]}
                    onPress={() => moveTo(l.id)}
                  />
                ))}
              </ScrollView>
            )}
            <View style={styles.row}>
              <LibraryButton
                style={{ flex: 1 }}
                label="Elsewhere"
                tone="ghost"
                icon={(c) => <ReshelveIcon size={20} color={c} />}
                onPress={() => router.push({ pathname: '/move/[id]', params: { id: item.id } })}
              />
              <LibraryButton
                style={{ flex: 1 }}
                label="Lend it"
                icon={(c) => <CheckedOutIcon size={20} color={c} />}
                onPress={() => router.push({ pathname: '/lend/[id]', params: { id: item.id } })}
              />
            </View>
          </View>
        )}

        <DateDueSlip history={history} />

        <LibraryButton label="Withdraw from catalog" tone="ghost" icon={(c) => <BinIcon size={18} color={c} />} onPress={withdraw} />
      </ScrollView>
    </Room>
  );
}

const todayStamp = () => stampDate(Date.now());

function Thumb({ id, tilt, onPress }: { id: string; tilt: number; onPress: () => void }) {
  return <PhotoPlate base64={null} photoId={id} aspect={1} style={{ width: 84 }} tilt={tilt} onPress={onPress} />;
}

const showError = (e: unknown) =>
  Alert.alert("That didn't save", e instanceof Error ? e.message : String(e));

function EditFields({
  initial,
  photo,
  onDone,
}: {
  initial: { name: string; tags: string; notes: string };
  /** Cover photo (base64 JPEG) for the assistant to look at. */
  photo: string | null;
  onDone: (v: { name: string; tags: string; notes: string; aiTags: string[] }) => Promise<void>;
}) {
  const p = usePalette();
  const [v, setV] = useState({ ...initial, aiTags: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={{ gap: 16 }}>
      <TypedInput big value={v.name} onChangeText={(name) => setV({ ...v, name })} autoFocus accessibilityLabel="Name" />
      <TypedInput label="Subjects (comma separated)" value={v.tags} onChangeText={(tags) => setV({ ...v, tags })} autoCapitalize="none" />
      <SuggestSubjects
        name={v.name}
        notes={v.notes}
        photo={photo ? { base64: photo } : null}
        tags={v.tags}
        onTag={(t) => setV((cur) => ({ ...cur, tags: withTag(cur.tags, t), aiTags: [...cur.aiTags, t] }))}
      />
      <TypedInput label="Notes" value={v.notes} onChangeText={(notes) => setV({ ...v, notes })} multiline />
      {error && (
        <T variant="small" color={p.stamp}>
          {error}
        </T>
      )}
      <LibraryButton
        label="Save card"
        tone="lamp"
        compact
        onPress={() => onDone(v).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}
      />
    </View>
  );
}

/** The item's history, drawn as the date-due slip pasted inside a book. */
function DateDueSlip({ history }: { history: HistoryEvent[] }) {
  const p = usePalette();
  if (history.length === 0) return null;
  return (
    <View style={[styles.slip, { backgroundColor: p.scheme === 'dark' ? '#2E2418' : '#F4E9C9', borderColor: p.cardEdge }]}>
      <T variant="label" style={{ textAlign: 'center', marginBottom: 6 }}>
        Circulation record
      </T>
      {history.map((h) => (
        <View key={h.id} style={[styles.slipRow, { borderTopColor: p.rule }]}>
          <T variant="small" color={eventColor(h, p)} style={styles.slipDate}>
            {stampDate(h.at)}
          </T>
          <T variant="typed" style={{ flex: 1 }}>
            {describe(h)}
          </T>
        </View>
      ))}
    </View>
  );
}

function eventColor(h: HistoryEvent, p: ReturnType<typeof usePalette>) {
  if (h.kind === 'lent') return p.stamp;
  if (h.kind === 'returned') return p.stampReturned;
  return p.lampText;
}

function describe(h: HistoryEvent): string {
  switch (h.kind) {
    case 'lent':
      return `Lent to ${h.person}${h.dueAt ? `, due ${shortDate(h.dueAt)}` : ''}`;
    case 'returned':
      return `Returned by ${h.person}`;
    case 'moved':
      if (!h.fromPath) return `Shelved at ${h.toPath ?? 'nowhere'}`;
      return `Moved from ${h.fromPath.split(' › ').pop()} to ${h.toPath ?? 'no shelf'}`;
  }
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 22 },
  pathWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  pathPart: { flexDirection: 'row', alignItems: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  addPhoto: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  row: { flexDirection: 'row', gap: 10 },
  slip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 2, padding: 14 },
  slipRow: { flexDirection: 'row', gap: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  slipDate: { width: 98, fontFamily: fonts.stamp, fontSize: 12 },
});
