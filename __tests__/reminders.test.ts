import type { Item } from '../src/db/types';
import { endOfDay } from '../src/lib/format';
import { planReminders } from '../src/reminders/plan';

const DAY = 86_400_000;
const now = new Date(2026, 9, 24, 12, 0).getTime();

function lent(name: string, dueAt: number | null, id = name): Item {
  return {
    id,
    name,
    notes: null,
    locationId: null,
    createdAt: 0,
    updatedAt: 0,
    tags: [],
    photoIds: [],
    cover: null,
    activeLoan: { id: `loan-${id}`, itemId: id, person: 'Sam', lentAt: 0, dueAt, returnedAt: null, notes: null },
  };
}

describe('planReminders', () => {
  it('reminds at 9am on the due day and nudges three days later', () => {
    const plan = planReminders([lent('Ladder', endOfDay(now + 2 * DAY))], now, false);
    expect(plan.map((r) => [r.id, new Date(r.at).getDate(), new Date(r.at).getHours()])).toEqual([
      ['due:loan-Ladder', 26, 9],
      ['late:loan-Ladder', 29, 9],
    ]);
    expect(plan[0]!.title).toBe('“Ladder” is due back today');
  });

  it('skips past moments, loans without a date and returned things', () => {
    const today = planReminders([lent('Book', endOfDay(now))], now, false);
    expect(today.map((r) => r.id)).toEqual(['late:loan-Book']);
    const longAgo = planReminders([lent('Old', now - 10 * DAY), lent('Open', null)], now, false);
    expect(longAgo).toEqual([]);
    const item = lent('Back', now + 5 * DAY);
    expect(planReminders([{ ...item, activeLoan: null }], now, false)).toEqual([]);
  });

  it('keeps the lock screen discreet when the app is locked', () => {
    const [r] = planReminders([lent('Passport', endOfDay(now + DAY))], now, true);
    expect(r!.title).not.toContain('Passport');
    expect(r!.body).not.toContain('Sam');
  });
});
