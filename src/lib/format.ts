const DAY = 24 * 60 * 60 * 1000;

/**
 * A library-style call number for a place path, e.g.
 * ["House", "Garage", "Blue box"] -> "HOU·GAR·BB". Purely decorative, but it
 * makes a place recognisable at a glance on a card.
 */
export function callNumber(pathNames: string[]): string {
  if (pathNames.length === 0) return 'UNSHELVED';
  return pathNames
    .slice(-3)
    .map((name) => {
      const words = name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .filter(Boolean);
      if (words.length === 0) return '?';
      if (words.length === 1) return words[0]!.slice(0, 3);
      return words
        .slice(0, 3)
        .map((w) => w[0])
        .join('');
    })
    .join('·');
}

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Due dates are whole days: the end of the chosen day. */
export function endOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** The end of the day `days` calendar days from now (a week is 7 days, even across a DST change). */
export function daysFromNow(days: number, now = Date.now()): number {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return endOfDay(d.getTime());
}

export type DueState = 'none' | 'ok' | 'soon' | 'overdue';

export function dueState(dueAt: number | null, now = Date.now()): DueState {
  if (dueAt === null) return 'none';
  if (dueAt < now) return 'overdue';
  if (dueAt - now < 3 * DAY) return 'soon';
  return 'ok';
}

export function stampDate(t: number): string {
  return new Date(t)
    .toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
}

export function shortDate(t: number, now = Date.now()): string {
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function relativeDays(t: number, now = Date.now()): string {
  const days = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) return `in ${days} days`;
  return `${-days} days ago`;
}

/** True if `t` is missing or more than `ms` in the past. */
export function olderThan(t: number | null, ms: number, now = Date.now()): boolean {
  return t === null || now - t > ms;
}
