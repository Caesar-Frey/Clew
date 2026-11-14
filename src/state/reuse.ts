import type { Item, Loan } from '../db/types';

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

const sameLoan = (a: Loan | null, b: Loan | null) =>
  a === b || (!!a && !!b && a.id === b.id && a.person === b.person && a.dueAt === b.dueAt && a.lentAt === b.lentAt);

export function sameItem(a: Item, b: Item): boolean {
  return (
    a.id === b.id &&
    a.updatedAt === b.updatedAt &&
    a.name === b.name &&
    a.notes === b.notes &&
    a.locationId === b.locationId &&
    a.cover === b.cover &&
    sameList(a.tags, b.tags) &&
    sameList(a.photoIds, b.photoIds) &&
    sameLoan(a.activeLoan, b.activeLoan)
  );
}

/**
 * Keeps the previous object for every item that didn't change, so memoised
 * cards and the search index skip them. Returns `prev` itself if nothing changed.
 */
export function reuseItems(prev: readonly Item[], next: Item[]): Item[] {
  const old = new Map(prev.map((i) => [i.id, i]));
  let changed = prev.length !== next.length;
  const out = next.map((n, i) => {
    const o = old.get(n.id);
    if (o && sameItem(o, n)) {
      if (prev[i] !== o) changed = true;
      return o;
    }
    changed = true;
    return n;
  });
  return changed ? out : (prev as Item[]);
}
