import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ocrNote, scanBox, useBoxMatcher, type RankedBox, type Scan } from '@/components/BoxScanner';
import { PhotoPlate } from '@/components/PhotoPlate';
import { PlacePicker, usePlaceField } from '@/components/PlacePicker';
import { isGenericWord } from '@/boxes/fingerprint';
import { useData } from '@/state/data';
import { IndexCard, KeyboardScreen, LibraryButton, Room, Stamp, T } from '@/ui/components';
import { CameraIcon } from '@/ui/icons';
import { usePalette } from '@/ui/theme';
import { useToast } from '@/ui/toast';

type State = 'scanning' | 'done' | 'cancelled' | 'saveNew';

/**
 * "Which box is this?": photograph a box or its label. Clew never decides on
 * its own: it shows your photo beside the saved one and asks. Confirming adds
 * the new photo as another view, so recognition improves with use.
 */
export default function IdentifyScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { match } = useBoxMatcher();
  const { actions, index } = useData();
  const toast = useToast();
  const [state, setState] = useState<State>('scanning');
  const [scan, setScan] = useState<Scan | null>(null);
  const [results, setResults] = useState<RankedBox[]>([]);
  const [showing, setShowing] = useState(0);
  const [busy, setBusy] = useState(false);
  const target = usePlaceField();

  const scanAndMatch = useCallback(async () => {
    const s = await scanBox('Photograph the box or its label');
    return s ? { scan: s, results: match(s.view).filter((r) => r.strength !== 'weak').slice(0, 3) } : null;
  }, [match]);
  const apply = useCallback((r: { scan: Scan; results: RankedBox[] } | null) => {
    if (!r) return setState('cancelled');
    setScan(r.scan);
    setResults(r.results);
    setShowing(0);
    setState('done');
  }, []);
  const run = () => {
    setState('scanning');
    scanAndMatch().then(apply);
  };

  useEffect(() => {
    // Scan once on open; "Try another photo" scans again.
    scanAndMatch().then(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Confirmed: remember this shot as another view of the box, then open it. */
  const confirm = async (locationId: string) => {
    if (!scan) return;
    setBusy(true);
    try {
      await actions.addBoxView(locationId, scan.view, scan.photo);
      router.replace({ pathname: '/place/[id]', params: { id: locationId } });
    } catch (e) {
      Alert.alert("Couldn't save that photo", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveNew = async () => {
    if (!scan) return;
    if (target.value.kind === 'none') {
      Alert.alert('Which place is this box?', 'Pick a place from the list, or create a new one.');
      return;
    }
    setBusy(true);
    try {
      const id = await actions.ensurePlace(target.value);
      if (!id) return;
      await actions.addBoxView(id, scan.view, scan.photo);
      toast({ message: `Saved what ${index.byId.get(id)?.name ?? 'the box'} looks like` });
      router.replace({ pathname: '/place/[id]', params: { id } });
    } catch (e) {
      Alert.alert("Couldn't save that", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const strong = results[0]?.strength === 'strong';
  const current = results[showing];

  return (
    <Room>
      <KeyboardScreen>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24, gap: 16 }}>
          {state === 'scanning' && (
            <View style={styles.center}>
              <ActivityIndicator color={p.leather} />
              <T variant="italic" color={p.inkSoft}>
                Consulting the card catalog…
              </T>
            </View>
          )}
          {state === 'cancelled' && (
            <View style={styles.center}>
              <T variant="italic" color={p.inkSoft} style={{ textAlign: 'center' }}>
                Take a photo of a box, or of the label you wrote on it, and Clew finds which one it is.
              </T>
              <LibraryButton label="Take a photo" icon={(c) => <CameraIcon size={20} color={c} />} onPress={run} />
            </View>
          )}

          {state === 'saveNew' && scan && (
            <>
              <T variant="heading" accessibilityRole="header">
                Which place is this box?
              </T>
              <PhotoPlate base64={scan.photo.thumb} aspect={1} style={{ width: 120, alignSelf: 'center' }} />
              <PlacePicker field={target} label="This box is" autoFocus optional={false} />
              <LibraryButton label={busy ? 'Saving…' : 'Save as this box'} tone="leather" disabled={busy} onPress={saveNew} />
              <LibraryButton label="Back" tone="ghost" compact onPress={() => setState('done')} />
            </>
          )}

          {state === 'done' && scan && (
            <>
              {results.length === 0 ? (
                <>
                  <View style={styles.row}>
                    <PhotoPlate base64={scan.photo.thumb} aspect={1} style={{ width: 96 }} />
                    <T variant="typed" color={p.inkSoft} style={{ flex: 1 }}>
                      {ocrNote(scan)}
                    </T>
                  </View>
                  <View style={styles.center}>
                    <Stamp text="No match" sub="not in the catalog" color={p.stamp} animate={false} />
                    <T variant="italic" color={p.inkSoft} style={{ textAlign: 'center' }}>
                      None of your saved boxes looks like this.
                    </T>
                  </View>
                </>
              ) : strong && current ? (
                <>
                  <T variant="label" color={p.headRule} accessibilityRole="header">
                    {showing === 0 ? 'Is it this one?' : `Or this one? (${showing + 1} of ${results.length})`}
                  </T>
                  <Candidate scan={scan} result={current} />
                  <LibraryButton label="Yes, that's it" tone="leather" disabled={busy} onPress={() => confirm(current.value)} />
                  {showing + 1 < results.length && (
                    <LibraryButton
                      label={`No, show others (${results.length - showing - 1})`}
                      tone="ghost"
                      onPress={() => setShowing((n) => n + 1)}
                    />
                  )}
                </>
              ) : (
                <>
                  <T variant="label" color={p.headRule} accessibilityRole="header">
                    Could be one of these
                  </T>
                  {results.map((r) => (
                    <View key={r.value} style={{ gap: 10 }}>
                      <Candidate scan={scan} result={r} />
                      <LibraryButton label="Yes, this one" tone="ghost" compact disabled={busy} onPress={() => confirm(r.value)} />
                    </View>
                  ))}
                </>
              )}
              <LibraryButton label="None of these: save as a new box" tone="ghost" onPress={() => setState('saveNew')} />
              <LibraryButton label="Try another photo" tone="ghost" compact icon={(c) => <CameraIcon size={18} color={c} />} onPress={run} />
            </>
          )}
        </ScrollView>
      </KeyboardScreen>
    </Room>
  );
}

/** The new photo beside the saved one, and what's inside the candidate box. */
function Candidate({ scan, result }: { scan: Scan; result: RankedBox }) {
  const p = usePalette();
  const { index, items, boxes } = useData();
  const place = index.byId.get(result.value);
  if (!place) return null;
  const inside = index.subtreeIds(place.id);
  const things = items.filter((it) => it.locationId && inside.has(it.locationId));
  const box = boxes.get(place.id);
  const savedWords = new Set(box?.fp?.views.flatMap((v) => v.words) ?? []);
  const both = scan.view.words.filter((w) => w.length >= 3 && !isGenericWord(w) && savedWords.has(w));
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.pair}>
        <View style={{ flex: 1, gap: 4 }}>
          <PhotoPlate base64={scan.photo.thumb} aspect={1} accessibilityLabel="Your photo" />
          <T variant="small">your photo</T>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          {box?.cover ? (
            <PhotoPlate base64={box.cover} aspect={1} accessibilityLabel={`Saved photo of ${place.name}`} />
          ) : (
            <View style={[styles.noPhoto, { borderColor: p.inkFaint }]} />
          )}
          <T variant="small">saved: {place.name}</T>
        </View>
      </View>
      <IndexCard punched={false} ruled={false} style={{ paddingBottom: 14 }}>
        <View style={{ gap: 4 }}>
          <T variant="heading">{place.name}</T>
          <T variant="small">
            {index.pathString(place.id)} · {things.length} {things.length === 1 ? 'thing' : 'things'}
            {things.length ? `: ${things.slice(0, 5).map((t) => t.name).join(', ')}${things.length > 5 ? ` and ${things.length - 5} more` : ''}` : ''}
          </T>
          <T variant="small" color={p.inkSoft}>
            {both.length ? `Read on both: “${both.join(' ').toUpperCase()}”` : ocrNote(scan)}
          </T>
        </View>
      </IndexCard>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 16, paddingVertical: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pair: { flexDirection: 'row', gap: 12 },
  noPhoto: { aspectRatio: 1, borderWidth: 1, borderStyle: 'dashed', borderRadius: 3 },
});
