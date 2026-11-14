import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { PlacePicker, usePlaceField } from '@/components/PlacePicker';
import { goBackOrHome } from '@/lib/nav';
import { useData } from '@/state/data';
import { KeyboardScreen, LibraryButton, Room, T } from '@/ui/components';
import { usePalette } from '@/ui/theme';
import { useToast } from '@/ui/toast';

/** Put a place inside another one (or at the top level), with everything in it. */
export default function MovePlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { actions, index } = useData();
  const p = usePalette();
  const toast = useToast();
  const place = index.byId.get(id);
  const field = usePlaceField();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!place) return <Room>{null}</Room>;
  const oldParent = place.parentId;

  const move = async () => {
    if (busy) return;
    if (field.pending) {
      setError('Pick a place from the list, or tap “Create new place”.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const parentId = await actions.ensurePlace(field.value);
      if (parentId === oldParent) {
        goBackOrHome();
        return;
      }
      await actions.setPlaceParent(place.id, parentId);
      goBackOrHome();
      toast({
        message: parentId ? `Moved “${place.name}” into ${index.byId.get(parentId)?.name ?? 'the new place'}` : `“${place.name}” is now a top-level place`,
        undo: () => actions.setPlaceParent(place.id, oldParent),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const target = field.value.kind === 'none' && !field.pending ? 'Make it a top-level place' : 'Move it here';
  return (
    <Room>
      <KeyboardScreen>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 20 }}>
          <T variant="heading" accessibilityRole="header">
            Where is “{place.name}” now?
          </T>
          <T variant="typed" color={p.inkSoft}>
            {oldParent ? `Currently inside ${index.pathString(oldParent)}` : 'Currently a top-level place'}. Everything in it moves too.
          </T>
          <PlacePicker field={field} label="Put it inside" autoFocus optional excludeId={place.id} contextId={oldParent ?? undefined} />
          {error && (
            <T variant="typed" color={p.stamp} accessibilityLiveRegion="polite">
              {error}
            </T>
          )}
          <LibraryButton label={busy ? 'Moving…' : target} tone="lamp" disabled={busy} onPress={move} />
        </ScrollView>
      </KeyboardScreen>
    </Room>
  );
}
