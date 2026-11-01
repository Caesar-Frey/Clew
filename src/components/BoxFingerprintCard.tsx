import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';

import { useData } from '@/state/data';
import { IndexCard, LibraryButton, T } from '@/ui/components';
import { CameraIcon, LoupeIcon } from '@/ui/icons';
import { usePalette } from '@/ui/theme';

import { scanBox } from './BoxScanner';
import { PhotoPlate } from './PhotoPlate';

/** On a place's page: teach Clew what this box looks like. */
export function BoxFingerprintCard({ locationId, name }: { locationId: string; name: string }) {
  const p = usePalette();
  const { boxes, actions } = useData();
  const box = boxes.get(locationId);
  const views = box?.fp?.views ?? [];
  const label = views.map((v) => v.text).filter(Boolean)[0];
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const scan = await scanBox(views.length ? 'Another view of the box' : 'Photograph the box or its label');
    if (!scan) return;
    setBusy(true);
    try {
      await actions.addBoxView(locationId, scan.view, scan.photo);
    } catch (e) {
      Alert.alert("Couldn't save that", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const forget = () =>
    Alert.alert(`Forget what “${name}” looks like?`, 'Its photos and fingerprint are removed. Its contents stay.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: () => actions.clearBox(locationId) },
    ]);

  if (!views.length && !box?.photoIds.length) {
    return (
      <IndexCard punched={false} ruled={false} style={{ paddingBottom: 16 }}>
        <View style={{ gap: 10 }}>
          <T variant="heading">Recognise this box</T>
          <T variant="small">
            Photograph the box, or the label you wrote on it. Next time, point the camera at it to see what&apos;s inside. No stickers or
            QR codes needed.
          </T>
          {busy ? (
            <ActivityIndicator color={p.leather} />
          ) : (
            <LibraryButton compact tone="lamp" label="Fingerprint this box" icon={(c) => <CameraIcon size={18} color={c} />} onPress={add} />
          )}
        </View>
      </IndexCard>
    );
  }

  return (
    <IndexCard punched={false} ruled={false} style={{ paddingBottom: 16 }}>
      <View style={{ gap: 12 }}>
        <View style={styles.row}>
          <T variant="label" style={{ flex: 1 }}>
            Box fingerprint · {views.length} {views.length === 1 ? 'view' : 'views'}
          </T>
          {busy && <ActivityIndicator color={p.leather} />}
        </View>
        {box && box.photoIds.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, padding: 4 }}>
            {box.photoIds.map((id, i) => (
              <BoxThumb key={id} id={id} tilt={i % 2 ? 1.5 : -1.5} />
            ))}
          </ScrollView>
        )}
        {label ? (
          <T variant="typed" color={p.inkSoft}>
            Label reads: “{label}”
          </T>
        ) : null}
        <View style={styles.row}>
          <LibraryButton style={{ flex: 1 }} compact tone="ghost" label="Add a view" icon={(c) => <CameraIcon size={16} color={c} />} onPress={add} />
          <LibraryButton style={{ flex: 1 }} compact tone="ghost" label="Forget" onPress={forget} />
        </View>
        <LibraryButton compact label="Test: which box is this?" tone="ghost" icon={(c) => <LoupeIcon size={16} color={c} />} onPress={() => router.push('/identify')} />
      </View>
    </IndexCard>
  );
}

function BoxThumb({ id, tilt }: { id: string; tilt: number }) {
  return (
    <PhotoPlate
      base64={null}
      photoId={id}
      aspect={1}
      style={{ width: 84 }}
      tilt={tilt}
      onPress={() => router.push({ pathname: '/photo/[id]', params: { id } })}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
