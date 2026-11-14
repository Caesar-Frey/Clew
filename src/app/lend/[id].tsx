import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

import { goBackOrHome } from '@/lib/nav';
import { LoanFields, type LoanValue } from '@/components/LoanFields';
import { useData, useItem } from '@/state/data';
import { LibraryButton, Room, T } from '@/ui/components';
import { usePalette } from '@/ui/theme';

/** Lend something out, or change the due date of a current loan. */
export default function LendScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useItem(id);
  const { actions } = useData();
  const p = usePalette();
  const existing = item?.activeLoan ?? null;
  const [loan, setLoan] = useState<LoanValue>({ person: existing?.person ?? '', dueAt: existing?.dueAt ?? null });
  const [error, setError] = useState<string | null>(null);

  if (!item) return <Room>{null}</Room>;

  const save = async () => {
    try {
      if (existing) await actions.setLoanDue(existing.id, loan.dueAt);
      else await actions.lendItem(item.id, loan);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      goBackOrHome();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Room>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 20 }}>
          <T variant="heading">{existing ? `When should ${existing.person} bring it back?` : `Who's borrowing “${item.name}”?`}</T>
          {existing ? null : (
            <T variant="italic" color={p.inkSoft}>
              {"It keeps its shelf, so you'll know where it goes when it's back."}
            </T>
          )}
          <LoanFields value={loan} onChange={setLoan} autoFocus={!existing} personLocked={!!existing} />
          {error && (
            <T variant="typed" color={p.stamp}>
              {error}
            </T>
          )}
          <LibraryButton label={existing ? 'Update due date' : 'Check it out'} disabled={!loan.person.trim()} onPress={save} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Room>
  );
}
