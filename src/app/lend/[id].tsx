import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { LoanFields, type LoanValue } from '@/components/LoanFields';
import { useData, useItem } from '@/state/data';
import { KeyboardScreen, LibraryButton, Room, T } from '@/ui/components';
import { usePalette } from '@/ui/theme';
import { useToast } from '@/ui/toast';
import { useDiscardGuard } from '@/ui/useDiscardGuard';
import { haptic } from '@/ui/haptics';

/** Lend something out, or change the due date of a current loan. */
export default function LendScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useItem(id);
  const { actions } = useData();
  const p = usePalette();
  const toast = useToast();
  const existing = item?.activeLoan ?? null;
  const initial: LoanValue = { person: existing?.person ?? '', dueAt: existing?.dueAt ?? null };
  const [loan, setLoan] = useState<LoanValue>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = loan.person.trim() !== initial.person || loan.dueAt !== initial.dueAt;
  const { leave } = useDiscardGuard(dirty && !busy);

  if (!item) return <Room>{null}</Room>;

  const save = async () => {
    if (!loan.person.trim()) {
      setError('Who are you lending it to?');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (existing) await actions.setLoanDue(existing.id, loan.dueAt);
      else {
        const loanId = await actions.lendItem(item.id, loan);
        toast({ message: `Lent “${item.name}” to ${loan.person.trim()}`, undo: () => actions.undoLend(loanId) });
      }
      haptic.success().catch(() => {});
      leave();
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
            {existing ? `When should ${existing.person} bring it back?` : `Who's borrowing “${item.name}”?`}
          </T>
          {existing ? null : (
            <T variant="italic" color={p.inkSoft}>
              {"It keeps its place, so you'll know where it goes when it's back."}
            </T>
          )}
          <LoanFields value={loan} onChange={setLoan} autoFocus={!existing} personLocked={!!existing} />
          {error && (
            <T variant="typed" color={p.stamp} accessibilityLiveRegion="polite">
              {error}
            </T>
          )}
          <LibraryButton
            label={busy ? 'Saving…' : existing ? 'Update due date' : `Lend to ${loan.person.trim() || 'someone'}`}
            disabled={busy}
            haptic={false}
            onPress={save}
          />
        </ScrollView>
      </KeyboardScreen>
    </Room>
  );
}
