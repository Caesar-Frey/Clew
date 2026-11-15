import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useAssistant } from '@/ai/assistant';
import { tagList, type TagDraft } from '@/ai/text';
import { T } from '@/ui/components';
import { SparkIcon } from '@/ui/icons';
import { fonts, usePalette } from '@/ui/theme';
import { haptic } from '@/ui/haptics';

/**
 * "Suggest tags": asks the on-device assistant for a name and tags,
 * shown as pencilled slips the user taps to keep. Nothing is applied without
 * a tap. Renders nothing unless the assistant is installed.
 */
export function SuggestSubjects({
  name,
  notes,
  photo,
  tags,
  onTag,
  onName,
  autoAsk,
}: {
  name: string;
  notes?: string;
  photo: { uri?: string; base64?: string } | null;
  /** The tags field as typed. */
  tags: string;
  onTag: (tag: string) => void;
  /** Offered only when set (e.g. while the name is still empty). */
  onName?: (name: string) => void;
  /** Ask by itself when a photo arrives (photo-first adding). */
  autoAsk?: boolean;
}) {
  const p = usePalette();
  const { status, suggest } = useAssistant();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<TagDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = status.state === 'ready';

  const ask = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await suggest({ name, notes, photo, existing: tagList(tags) });
      setDraft(d);
      if (!d.tags.length && !d.name) setError('No ideas this time. Try a clearer photo.');
    } catch {
      setError("The assistant couldn't look just now.");
    } finally {
      setBusy(false);
    }
  }, [suggest, name, notes, photo, tags]);

  // Photo first, no name yet: look at it straight away, once per photo.
  const askedFor = useRef<string | null>(null);
  const photoKey = photo?.base64 ?? photo?.uri ?? null;
  const wantsAuto = !!autoAsk && ready && !!photoKey && !name.trim() && !busy;
  useEffect(() => {
    if (!wantsAuto || askedFor.current === photoKey) return;
    askedFor.current = photoKey;
    Promise.resolve().then(ask);
  }, [wantsAuto, photoKey, ask]);

  if (!ready) return null;
  const canAsk = !busy && (!!name.trim() || !!photo);
  const have = new Set(tagList(tags).map((t) => t.toLowerCase()));
  const open = draft?.tags.filter((t) => !have.has(t)) ?? [];
  const offerName = onName && draft?.name && draft.name.toLowerCase() !== name.trim().toLowerCase() ? draft.name : null;

  return (
    <View style={{ gap: 10 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Suggest tags"
        accessibilityHint={photo ? 'The assistant looks at the photo on this phone' : 'The assistant reads the name on this phone'}
        accessibilityState={{ disabled: !canAsk, busy }}
        disabled={!canAsk}
        onPress={ask}
        hitSlop={8}
        style={[styles.ask, { opacity: canAsk || busy ? 1 : 0.45 }]}
      >
        {busy ? <ActivityIndicator size="small" color={p.leatherText} /> : <SparkIcon size={16} color={p.leatherText} />}
        <T variant="small" color={p.leatherText}>
          {busy ? 'The assistant is looking…' : draft ? 'Suggest again' : 'Suggest tags'}
        </T>
      </Pressable>

      {(offerName || open.length > 0) && (
        <View style={styles.slips} accessibilityLabel="Suggestions. Tap one to keep it.">
          {offerName && (
            <Slip
              label={`Call it “${offerName}”`}
              a11y={`Use the name ${offerName}`}
              onPress={() => {
                onName?.(offerName);
                setDraft((d) => (d ? { ...d, name: null } : d));
              }}
            />
          )}
          {open.map((t) => (
            <Slip key={t} label={`+ ${t}`} a11y={`Add tag ${t}`} onPress={() => onTag(t)} />
          ))}
        </View>
      )}
      {error && (
        <T variant="small" color={p.inkSoft} accessibilityLiveRegion="polite">
          {error}
        </T>
      )}
    </View>
  );
}

function Slip({ label, a11y, onPress }: { label: string; a11y: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => {
        haptic.selection().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        styles.slip,
        { borderColor: p.leatherText, backgroundColor: pressed ? p.rule : 'transparent', transform: [{ rotate: pressed ? '0deg' : '-1deg' }] },
      ]}
    >
      <T style={[styles.slipText, { color: p.leatherText }]}>{label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ask: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  slips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slip: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 3, paddingHorizontal: 10, paddingVertical: 5 },
  slipText: { fontFamily: fonts.typed, fontSize: 14 },
});
