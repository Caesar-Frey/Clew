import { useMemo, useRef, useState, type Ref } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View, type TextInputInstance } from 'react-native';

import { NO_PLACE, optionValue, placeLabel, placeOptions, placeSearchIndex, type PlaceOption, type PlaceValue } from '@/lib/placeQuery';
import { useData, useRecentPlaces } from '@/state/data';
import { SpineChip, T, TypedInput } from '@/ui/components';
import { CameraIcon, CloseIcon, PigeonholeIcon } from '@/ui/icons';
import { usePalette } from '@/ui/theme';

import { scanBox, useBoxMatcher } from './BoxScanner';

/** State for one place field: the chosen place and the text being typed. */
export function usePlaceField(initial: PlaceValue = NO_PLACE) {
  const [value, setValue] = useState<PlaceValue>(initial);
  const [query, setQuery] = useState('');
  return {
    value,
    query,
    setValue,
    setQuery,
    /** Clears both, e.g. after saving. */
    reset: (v: PlaceValue = NO_PLACE) => {
      setValue(v);
      setQuery('');
    },
    /** Typed text that hasn't been turned into a choice yet. */
    pending: value.kind === 'none' && query.trim().length > 0,
  };
}

export type PlaceField = ReturnType<typeof usePlaceField>;

/**
 * Where something lives. Typing matches every place by its name and its full
 * path; the top match is highlighted and Return picks it. A new place is only
 * created through the explicit "Create new place" row. Return never saves the
 * form: `onPicked` lets the screen move focus on.
 */
export function PlacePicker({
  field,
  label = 'Where is it?',
  autoFocus,
  onPicked,
  inputRef,
  contextId,
  excludeId,
  optional = true,
}: {
  field: PlaceField;
  label?: string;
  autoFocus?: boolean;
  onPicked?: () => void;
  inputRef?: Ref<TextInputInstance>;
  /** The place the user is working in; new places can go inside it. */
  contextId?: string | null;
  /** A place (and everything inside it) that can't be chosen, e.g. when moving that place. */
  excludeId?: string;
  optional?: boolean;
}) {
  const p = usePalette();
  const { locations, index } = useData();
  const recent = useRecentPlaces(10);
  const { hasBoxes, match } = useBoxMatcher();
  const ownRef = useRef<TextInputInstance>(null);
  const ref = (inputRef ?? ownRef) as React.RefObject<TextInputInstance | null>;

  const blocked = useMemo(() => (excludeId ? index.subtreeIds(excludeId) : new Set<string>()), [excludeId, index]);
  const search = useMemo(() => placeSearchIndex(locations.filter((l) => !blocked.has(l.id)), index), [locations, index, blocked]);
  const options = useMemo(
    () =>
      placeOptions(field.query, locations, index, search, { contextId }).filter(
        (o) => o.kind === 'new' || !blocked.has(o.id),
      ),
    [field.query, locations, index, search, contextId, blocked],
  );

  const choose = (o: PlaceOption | PlaceValue) => {
    const v = 'path' in o || 'label' in o ? optionValue(o as PlaceOption) : (o as PlaceValue);
    field.setValue(v);
    field.setQuery('');
    onPicked?.();
  };

  const clear = () => {
    field.reset();
    setTimeout(() => ref.current?.focus(), 0);
  };

  /** Picks the place by photographing the box it's going into. Never picks on its own. */
  const scanForPlace = async () => {
    const scan = await scanBox('Photograph the box it goes in');
    if (!scan) return;
    const ranked = match(scan.view).filter((r) => r.strength !== 'weak' && index.byId.has(r.value) && !blocked.has(r.value));
    if (!ranked.length) {
      Alert.alert('No box matched', 'Type the place instead. You can photograph a box from its place page so it can be recognised.');
      return;
    }
    Alert.alert(ranked[0]!.strength === 'strong' ? 'Is it this box?' : 'Could be one of these', undefined, [
      ...ranked.slice(0, 3).map((r) => ({ text: index.pathString(r.value), onPress: () => choose({ kind: 'existing', id: r.value }) })),
      { text: 'None of these', style: 'cancel' as const },
    ]);
  };

  const chosen = field.value.kind !== 'none';
  const typing = field.query.trim().length > 0;

  return (
    <View style={{ gap: 10 }}>
      {chosen ? (
        <View style={{ gap: 4 }}>
          <T variant="label">{label}</T>
          <View style={[styles.chosen, { borderColor: p.inkSoft, backgroundColor: p.card }]}>
            <Pressable
              style={{ flex: 1, justifyContent: 'center', minHeight: 44 }}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${placeLabel(field.value, index)}${field.value.kind === 'new' ? ', new place' : ''}. Tap to change.`}
              onPress={clear}
            >
              <T variant="typed">
                {placeLabel(field.value, index)}
                {field.value.kind === 'new' ? '  (new)' : ''}
              </T>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Clear place" onPress={clear} style={styles.clear} hitSlop={12}>
              <CloseIcon size={14} color={p.inkSoft} />
            </Pressable>
          </View>
        </View>
      ) : (
        <TypedInput
          ref={ref}
          label={label}
          value={field.query}
          onChangeText={field.setQuery}
          autoFocus={autoFocus}
          placeholder={optional ? 'Type a few letters (optional)' : 'Type a few letters'}
          autoCapitalize="sentences"
          returnKeyType={options.length ? 'next' : 'done'}
          submitBehavior="submit"
          onSubmitEditing={() => {
            const top = options[0];
            if (top) choose(top);
          }}
          accessibilityHint="Matching places appear below. Return picks the first one."
        />
      )}

      {!chosen && hasBoxes && (
        <Pressable accessibilityRole="button" onPress={scanForPlace} style={styles.scan}>
          <CameraIcon size={16} color={p.leatherText} />
          <T variant="small" color={p.leatherText}>
            Scan the box it goes in
          </T>
        </Pressable>
      )}

      {!chosen && typing && options.length > 0 && (
        <View style={[styles.suggestions, { borderColor: p.cardEdge, backgroundColor: p.card }]}>
          {options.map((o, i) => {
            const top = i === 0;
            const key = o.kind === 'existing' ? o.id : `new-${o.parentId}-${o.label}`;
            const text = o.kind === 'existing' ? o.path : `Create new place “${o.names.join(' › ')}”${o.label ? ` ${o.label}` : ''}`;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={top ? `${text}. Return picks this.` : text}
                onPress={() => choose(o)}
                style={({ pressed }) => [
                  styles.suggestion,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.rule },
                  top && { backgroundColor: p.highlight, borderLeftWidth: 3, borderLeftColor: p.lamp },
                  pressed && { backgroundColor: p.cardEdge },
                ]}
              >
                {o.kind === 'existing' ? (
                  <PigeonholeIcon size={18} color={p.inkSoft} />
                ) : (
                  <T variant="typed" color={p.leatherText}>
                    +
                  </T>
                )}
                <T variant="typed" numberOfLines={2} style={{ flex: 1 }} color={o.kind === 'new' ? p.leatherText : p.ink}>
                  {text}
                </T>
                {top && (
                  <T variant="small" color={p.inkSoft} importantForAccessibility="no">
                    ↵
                  </T>
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      {!chosen && !typing && recent.length > 0 && (
        <View style={{ gap: 6 }}>
          <T variant="label">Recent places</T>
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingVertical: 8 }}
          >
            {recent
              .filter((l) => !blocked.has(l.id))
              .map((l) => (
                <SpineChip
                  key={l.id}
                  label={l.name}
                  hint={index.pathNames(l.parentId).join(' › ') || undefined}
                  selected={false}
                  onPress={() => choose({ kind: 'existing', id: l.id })}
                />
              ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scan: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 44 },
  chosen: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 3, paddingLeft: 12 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  suggestions: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, overflow: 'hidden' },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: 48, paddingVertical: 8 },
});
