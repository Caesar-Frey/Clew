import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { daysFromNow, endOfDay, shortDate } from '@/lib/format';
import { useData } from '@/state/data';
import { T, TypedInput } from '@/ui/components';
import { fonts, usePalette } from '@/ui/theme';

export interface LoanValue {
  person: string;
  dueAt: number | null;
}

const PRESETS: { label: string; days: number | null }[] = [
  { label: 'No date', days: null },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
];

/** Who's borrowing it and when it should come back. */
export function LoanFields({
  value,
  onChange,
  autoFocus,
  personLocked,
}: {
  value: LoanValue;
  onChange: (v: LoanValue) => void;
  autoFocus?: boolean;
  /** Only the due date can change, e.g. for an existing loan. */
  personLocked?: boolean;
}) {
  const p = usePalette();
  const { people } = useData();
  const [picking, setPicking] = useState(false);
  const [preset, setPreset] = useState<number | null | 'custom'>(value.dueAt ? 'custom' : null);
  const matches = people.filter(
    (n) => n.toLowerCase() !== value.person.trim().toLowerCase() && n.toLowerCase().includes(value.person.trim().toLowerCase()),
  );

  return (
    <View style={{ gap: 14 }}>
      {!personLocked && (
      <TypedInput
        label="Borrower"
        value={value.person}
        onChangeText={(person) => onChange({ ...value, person })}
        placeholder="Who has it?"
        autoFocus={autoFocus}
        autoCapitalize="words"
        textContentType="name"
      />
      )}
      {!personLocked && matches.length > 0 && (
        <View style={styles.wrap}>
          {matches.slice(0, 6).map((n) => (
            <Tag key={n} label={n} onPress={() => onChange({ ...value, person: n })} />
          ))}
        </View>
      )}

      <View style={{ gap: 8 }}>
        <T variant="label">Date due</T>
        <View style={styles.wrap}>
          {PRESETS.map((pr) => (
            <Tag
              key={pr.label}
              label={pr.label}
              selected={preset === pr.days}
              onPress={() => {
                setPreset(pr.days);
                setPicking(false);
                onChange({ ...value, dueAt: pr.days === null ? null : daysFromNow(pr.days) });
              }}
            />
          ))}
          <Tag
            label={preset === 'custom' && value.dueAt ? shortDate(value.dueAt) : 'Pick a date…'}
            selected={preset === 'custom'}
            onPress={() => setPicking((v) => !v)}
          />
        </View>
        {picking && (
          <View style={[styles.picker, { backgroundColor: p.card, borderColor: p.cardEdge }]}>
            <DateTimePicker
              value={new Date(value.dueAt ?? daysFromNow(7))}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              minimumDate={new Date()}
              accentColor={p.leather}
              onValueChange={(_, date) => {
                setPreset('custom');
                if (Platform.OS !== 'ios') setPicking(false);
                onChange({ ...value, dueAt: endOfDay(date.getTime()) });
              }}
              onDismiss={() => setPicking(false)}
            />
          </View>
        )}
      </View>
    </View>
  );
}

function Tag({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.tag,
        { borderColor: selected ? p.leather : p.inkFaint, backgroundColor: selected ? p.leather : 'transparent' },
      ]}
    >
      <T style={{ fontFamily: fonts.typed, fontSize: 14 }} color={selected ? p.onLeather : p.ink}>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  picker: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, overflow: 'hidden' },
});
