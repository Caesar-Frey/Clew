import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { goBackOrHome } from '@/lib/nav';
import { PlacePicker, usePlaceField } from '@/components/PlacePicker';
import { useData, useItem } from '@/state/data';
import { KeyboardScreen, LibraryButton, Room, T } from '@/ui/components';
import { usePalette } from '@/ui/theme';
import { useToast } from '@/ui/toast';

export default function MoveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useItem(id);
  const { actions, index } = useData();
  const p = usePalette();
  const place = usePlaceField();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  if (!item) return <Room>{null}</Room>;

  const move = async () => {
    if (place.value.kind === 'none') {
      setError(place.pending ? 'Pick a place from the list, or tap “Create new place”.' : 'Type a place name.');
      return;
    }
    setBusy(true);
    try {
      const moveId = await actions.moveItem(item.id, place.value);
      goBackOrHome();
      if (moveId) toast({ message: `Moved “${item.name}”`, undo: () => actions.undoMove(moveId) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Room>
      <KeyboardScreen>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 20 }}>
          <T variant="heading" accessibilityRole="header">
            Where does “{item.name}” live now?
          </T>
          {item.locationId && (
            <T variant="typed" color={p.inkSoft}>
              Currently: {index.pathString(item.locationId)}
            </T>
          )}
          <PlacePicker field={place} label="New place" autoFocus optional={false} contextId={item.locationId} />
          {error && (
            <T variant="typed" color={p.stamp} accessibilityLiveRegion="polite">
              {error}
            </T>
          )}
          <LibraryButton label={busy ? 'Moving…' : 'Move it here'} tone="lamp" disabled={busy} onPress={move} />
        </ScrollView>
      </KeyboardScreen>
    </Room>
  );
}
