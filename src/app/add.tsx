import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAssistant } from '@/ai/assistant';
import { tagList, withTag } from '@/ai/text';
import { LoanFields, type LoanValue } from '@/components/LoanFields';
import { askForPhoto, PhotoPlate } from '@/components/PhotoPlate';
import { PlacePicker, usePlaceField } from '@/components/PlacePicker';
import { SuggestSubjects } from '@/components/SuggestSubjects';
import { daysFromNow } from '@/lib/format';
import { PATH_SEPARATOR } from '@/lib/locations';
import { goBackOrHome } from '@/lib/nav';
import { findPath, NO_PLACE, placeLabel, saveLabel, shortPath } from '@/lib/placeQuery';
import type { CapturedPhoto } from '@/photos/capture';
import { useData } from '@/state/data';
import { IndexCard, KeyboardScreen, LibraryButton, Room, Stamp, T, TypedInput } from '@/ui/components';
import { HeaderText } from '@/ui/HeaderText';
import { CameraIcon, CloseIcon, MicrophoneIcon, PencilIcon, PersonIcon } from '@/ui/icons';
import { usePalette } from '@/ui/theme';
import { useToast } from '@/ui/toast';
import { useDiscardGuard } from '@/ui/useDiscardGuard';
import { parseSpokenCard, resolveSpokenPlace } from '@/voice/parse';
import { useDictation } from '@/voice/useDictation';

/** New card: name, place, then optional tools in one row. */
export default function AddScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ name?: string; placeId?: string }>();
  const { actions, locations, index, people, items } = useData();
  const { status: assistant } = useAssistant();
  const toast = useToast();
  const nameRef = useRef<TextInputInstance>(null);
  const placeRef = useRef<TextInputInstance>(null);

  const [name, setName] = useState(params.name ?? '');
  const place = usePlaceField(params.placeId ? { kind: 'existing', id: params.placeId } : NO_PLACE);
  const [lent, setLent] = useState(false);
  const [loan, setLoan] = useState<LoanValue>({ person: '', dueAt: null });
  const [more, setMore] = useState(false);
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [takingPhoto, setTakingPhoto] = useState(false);
  /** Tags the user took from the assistant's suggestions. */
  const [aiTags, setAiTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<{ name: string; n: number } | null>(null);

  const dirty = !!(name.trim() || photos.length || tags.trim() || notes.trim() || (lent && loan.person.trim()));
  const { leave } = useDiscardGuard(dirty && !saving);

  const dictation = useDictation((text) => {
    const card = parseSpokenCard(text);
    if (card.name) setName(card.name);
    if (card.person) {
      setLent(true);
      setLoan({ person: card.person, dueAt: card.dueInDays ? daysFromNow(card.dueInDays) : null });
      if (!card.name && !name.trim()) {
        setError('What did you lend? Type its name.');
        nameRef.current?.focus();
      }
    } else if (card.place.length) {
      setLent(false);
      // A spoken place that exists is chosen; anything else waits in the
      // field for the user to pick a match or create it.
      const path = resolveSpokenPlace(card.place, locations, index).join(PATH_SEPARATOR);
      const id = findPath(path, index);
      if (id) place.reset({ kind: 'existing', id });
      else {
        place.reset();
        place.setQuery(path);
      }
    }
  });
  const listening = dictation.state === 'listening';
  const listen = () => {
    if (listening) return dictation.stop();
    const hints = [...locations.map((l) => l.name), ...people, ...items.slice(0, 40).map((i) => i.name)];
    dictation.start(hints);
  };

  const takePhoto = async () => {
    setTakingPhoto(true);
    try {
      const ph = await askForPhoto();
      if (!ph) return;
      setPhotos((list) => [...list, ph]);
      // Photo first: the assistant offers a name if it is installed;
      // otherwise go straight to typing one.
      if (!name.trim() && assistant.state !== 'ready') setTimeout(() => nameRef.current?.focus(), 250);
    } finally {
      setTakingPhoto(false);
    }
  };

  const target = placeLabel(place.value, index);
  const label = saving ? 'Saving…' : saveLabel({ lent, person: loan.person, place: target });

  const save = async (another: boolean) => {
    if (saving) return;
    if (!name.trim()) {
      setError('Give it a name first.');
      nameRef.current?.focus();
      return;
    }
    if (lent && !loan.person.trim()) {
      setError('Who did you lend it to?');
      return;
    }
    if (place.pending) {
      setError('Pick a place from the list, or tap “Create new place”.');
      return;
    }
    setSaving(true);
    setError(null);
    const savedName = name.trim();
    try {
      const id = await actions.addItem({
        name,
        place: place.value,
        notes,
        tags: tagList(tags),
        aiTags: aiTags.filter((t) => tagList(tags).includes(t)),
        lendTo: lent ? { person: loan.person, dueAt: loan.dueAt } : undefined,
        photos,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const undo = () => actions.deleteItem(id);
      const view = { label: 'View', onPress: () => router.push(`/item/${id}`) };
      if (lent) toast({ message: `Lent “${savedName}” to ${loan.person.trim()}`, undo, action: view });
      else if (target) toast({ message: `Saved “${savedName}” in ${shortPath(target)}`, undo, action: view });
      else
        toast({
          message: `Saved “${savedName}” without a place`,
          undo,
          action: { label: 'Add place', onPress: () => router.push(`/move/${id}`) },
        });
      if (another) {
        // Keep the place: the next thing is usually going in the same spot.
        setLastSaved((s) => ({ name: savedName, n: (s?.n ?? 0) + 1 }));
        setName('');
        setTags('');
        setAiTags([]);
        setNotes('');
        setPhotos([]);
        setLent(false);
        setLoan({ person: '', dueAt: null });
        setMore(false);
        nameRef.current?.focus();
      } else {
        leave();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Room>
      <Stack.Screen options={{ headerLeft: () => <HeaderText label="Cancel" onPress={goBackOrHome} /> }} />
      <KeyboardScreen>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24, gap: 18 }}>
          {lastSaved && (
            <View key={lastSaved.n} style={styles.savedRow}>
              <Stamp text="Catalogued" sub={lastSaved.name} color={p.stampReturned} angle={-4} />
            </View>
          )}

          <IndexCard punched ruled={false}>
            <View style={{ gap: 20, paddingTop: 2 }}>
              <TypedInput
                ref={nameRef}
                big
                label="What is it?"
                value={name}
                onChangeText={setName}
                placeholder="Passport, drill, winter coat…"
                autoFocus={!params.name}
                autoCapitalize="sentences"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => placeRef.current?.focus()}
              />
              {(listening || !!dictation.transcript) && (
                <T variant="italic" color={p.inkSoft} accessibilityLiveRegion="polite">
                  {dictation.transcript
                    ? `“${dictation.transcript}”`
                    : 'Listening… try “the passport is in the desk drawer” or “I lent the drill to Sam”.'}
                </T>
              )}

              <PlacePicker
                field={place}
                label={lent ? 'Where it goes when it’s back' : 'Where is it?'}
                optional
                inputRef={placeRef}
                contextId={params.placeId}
                autoFocus={!!params.name}
                onPicked={() => placeRef.current?.blur()}
              />

              {lent && <LoanFields value={loan} onChange={setLoan} autoFocus />}

              {photos.length > 0 && (
                <View style={styles.photoRow}>
                  {photos.map((ph, i) => (
                    <View key={ph.thumb.slice(-24) + i}>
                      <PhotoPlate base64={ph.thumb} aspect={1} style={{ width: 72 }} tilt={i % 2 ? 1.5 : -1.5} />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Remove photo"
                        hitSlop={8}
                        onPress={() => setPhotos((list) => list.filter((x) => x !== ph))}
                        style={[styles.removePhoto, { backgroundColor: p.leather }]}
                      >
                        <CloseIcon size={12} color={p.onLeather} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              <SuggestSubjects
                name={name}
                notes={notes}
                photo={photos[0] ? { base64: photos[0].data } : null}
                tags={tags}
                autoAsk
                onName={name.trim() ? undefined : setName}
                onTag={(t) => {
                  setTags((cur) => withTag(cur, t));
                  setAiTags((cur) => [...cur, t]);
                  setMore(true);
                }}
              />

              <View style={styles.tools}>
                <Tool
                  label={photos.length ? `Photo (${photos.length})` : 'Photo'}
                  a11y={photos.length ? 'Add another photo' : 'Add a photo'}
                  disabled={photos.length >= 4}
                  onPress={takePhoto}
                  icon={takingPhoto ? <ActivityIndicator size="small" color={p.inkSoft} /> : <CameraIcon size={22} color={p.inkSoft} />}
                />
                <Tool
                  label={listening ? 'Stop' : 'Say it'}
                  a11y={listening ? 'Stop listening' : 'Say it instead of typing'}
                  on={listening}
                  onPress={listen}
                  icon={<MicrophoneIcon size={22} color={listening ? p.onLamp : p.inkSoft} />}
                />
                <Tool
                  label="Lent to someone"
                  on={lent}
                  toggle
                  onPress={() => setLent((v) => !v)}
                  icon={<PersonIcon size={22} color={lent ? p.onLamp : p.inkSoft} />}
                />
                <Tool
                  label="Tags, notes"
                  a11y="Add tags and notes"
                  on={more}
                  toggle
                  onPress={() => setMore((v) => !v)}
                  icon={<PencilIcon size={22} color={more ? p.onLamp : p.inkSoft} />}
                />
              </View>

              {more && (
                <View style={{ gap: 18 }}>
                  <TypedInput label="Tags (comma separated)" value={tags} onChangeText={setTags} placeholder="tools, camping" autoCapitalize="none" />
                  <TypedInput label="Notes" value={notes} onChangeText={setNotes} placeholder="Anything worth remembering" multiline />
                </View>
              )}
            </View>
          </IndexCard>

          {error && (
            <T variant="typed" color={p.stamp} accessibilityLiveRegion="polite">
              {error}
            </T>
          )}

          <LibraryButton label={label} onPress={() => save(false)} />
          <LibraryButton label="Save and add another" tone="ghost" onPress={() => save(true)} />
        </ScrollView>
      </KeyboardScreen>
    </Room>
  );
}

function Tool({
  label,
  a11y,
  icon,
  on,
  toggle,
  disabled,
  onPress,
}: {
  label: string;
  a11y?: string;
  icon: ReactNode;
  on?: boolean;
  /** A switch rather than an action (announced as checked or not). */
  toggle?: boolean;
  disabled?: boolean;
  onPress: () => void;
}): ReactNode {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole={toggle ? 'switch' : 'button'}
      accessibilityLabel={a11y ?? label}
      accessibilityState={toggle ? { checked: !!on, disabled } : { disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.tool,
        { borderColor: on ? p.lamp : p.inkFaint, backgroundColor: on ? p.lamp : 'transparent', opacity: disabled ? 0.45 : 1 },
        on ? styles.toolOn : null,
      ]}
    >
      {icon}
      <T variant="small" color={on ? p.onLamp : p.inkSoft} style={styles.toolLabel} numberOfLines={2}>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  savedRow: { alignItems: 'center' },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  removePhoto: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  tools: { flexDirection: 'row', gap: 8 },
  tool: {
    flex: 1,
    minHeight: 64,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  toolOn: { borderStyle: 'solid' },
  toolLabel: { textAlign: 'center' },
});
