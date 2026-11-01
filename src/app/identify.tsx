import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { scanBox, useBoxMatcher, type RankedBox, type Scan } from '@/components/BoxScanner';
import { PhotoPlate } from '@/components/PhotoPlate';
import { callNumber } from '@/lib/format';
import { useData } from '@/state/data';
import { IndexCard, LibraryButton, Room, SectionLabel, Stamp, T } from '@/ui/components';
import { CameraIcon } from '@/ui/icons';
import { usePalette } from '@/ui/theme';

/** "Which box is this?": photograph a box or its label to see what's inside. */
export default function IdentifyScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { match } = useBoxMatcher();
  const [state, setState] = useState<'scanning' | 'done' | 'cancelled'>('scanning');
  const [scan, setScan] = useState<Scan | null>(null);
  const [results, setResults] = useState<RankedBox[]>([]);

  const scanAndMatch = useCallback(async () => {
    const s = await scanBox('Photograph the box or its label');
    return s ? { scan: s, results: match(s.view).filter((r) => r.strength !== 'weak').slice(0, 3) } : null;
  }, [match]);
  const apply = useCallback((r: { scan: Scan; results: RankedBox[] } | null) => {
    if (!r) return setState('cancelled');
    setScan(r.scan);
    setResults(r.results);
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

  return (
    <Room>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24, gap: 16 }}>
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
        {state === 'done' && scan && (
          <>
            <View style={styles.row}>
              <PhotoPlate base64={scan.photo.thumb} aspect={1} style={{ width: 96 }} />
              <View style={{ flex: 1, gap: 4 }}>
                <T variant="label">Your photo</T>
                <T variant="typed" color={p.inkSoft} numberOfLines={3}>
                  {scan.view.text ? `Reads: ${scan.view.text}` : 'No writing found, matching by look.'}
                </T>
              </View>
            </View>
            {results.length === 0 ? (
              <View style={styles.center}>
                <Stamp text="No match" sub="not in the catalog" color={p.stamp} />
                <T variant="italic" color={p.inkSoft} style={{ textAlign: 'center' }}>
                  None of your fingerprinted boxes looks like this. To teach Clew a box, open its shelf and tap “Fingerprint this box”.
                </T>
              </View>
            ) : (
              <>
                <SectionLabel>{results[0]!.strength === 'strong' ? 'This is' : 'Could be'}</SectionLabel>
                {results.map((r, i) => (
                  <Result key={r.value} result={r} index={i} />
                ))}
              </>
            )}
            <LibraryButton label="Try another photo" tone="ghost" icon={(c) => <CameraIcon size={20} color={c} />} onPress={run} />
          </>
        )}
      </ScrollView>
    </Room>
  );
}

function Result({ result, index: i }: { result: RankedBox; index: number }) {
  const p = usePalette();
  const { index, items, boxes } = useData();
  const place = index.byId.get(result.value);
  if (!place) return null;
  const inside = index.subtreeIds(place.id);
  const things = items.filter((it) => it.locationId && inside.has(it.locationId));
  const box = boxes.get(place.id);
  return (
    <IndexCard
      enterIndex={i}
      onPress={() => router.replace({ pathname: '/place/[id]', params: { id: place.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${place.name}, ${things.length} things inside`}
    >
      <View style={styles.row}>
        {box?.cover ? <PhotoPlate base64={box.cover} aspect={1} style={{ width: 64 }} tilt={1.5} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="small" color={p.headRule} style={{ letterSpacing: 1.5 }}>
            {callNumber(index.pathNames(place.id))}
          </T>
          <T variant="heading">{place.name}</T>
          <T variant="small">{index.pathString(place.id)}</T>
        </View>
        <T variant="label" color={result.strength === 'strong' ? p.lampText : p.inkSoft}>
          {result.strength === 'strong' ? 'Match' : 'Maybe'}
        </T>
      </View>
      {things.length > 0 && (
        <T variant="typed" color={p.inkSoft} numberOfLines={3} style={{ marginTop: 10 }}>
          Inside: {things.slice(0, 6).map((t) => t.name).join(', ')}
          {things.length > 6 ? ` and ${things.length - 6} more` : ''}
        </T>
      )}
    </IndexCard>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 16, paddingVertical: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
});
