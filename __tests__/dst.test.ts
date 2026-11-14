import type { Item } from '../src/db/types';
import { daysFromNow, endOfDay } from '../src/lib/format';
import { planReminders } from '../src/reminders/plan';

const loan = (dueAt: number): Item => ({
  id: 'i',
  name: 'Ladder',
  notes: null,
  locationId: null,
  createdAt: 0,
  updatedAt: 0,
  tags: [],
  photoIds: [],
  cover: null,
  activeLoan: { id: 'l', itemId: 'i', person: 'Sam', lentAt: 0, dueAt, returnedAt: null, notes: null },
});

describe('calendar days across daylight saving (London, clocks go back 25 Oct 2026)', () => {
  const before = new Date(2026, 9, 22, 0, 30).getTime(); // Thu 22 Oct, 00:30

  it('"in a week" is the same weekday a week later', () => {
    const due = new Date(daysFromNow(7, before));
    expect([due.getDate(), due.getMonth(), due.getHours()]).toEqual([29, 9, 23]);
  });

  it('reminds at 09:00 local on the due day and three calendar days later', () => {
    const plan = planReminders([loan(endOfDay(new Date(2026, 9, 24).getTime()))], before, false);
    expect(plan.map((r) => [new Date(r.at).getDate(), new Date(r.at).getHours(), new Date(r.at).getMinutes()])).toEqual([
      [24, 9, 0],
      [27, 9, 0],
    ]);
  });
});
