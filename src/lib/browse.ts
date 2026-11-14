import type { Item } from '../db/types';
import { normalize } from '../search/fuzzy';

import type { LocationIndex } from './locations';

/** Which things the A–Z list shows: all, those without a place, or those inside one place. */
export type BrowseFilter = { kind: 'all' } | { kind: 'none' } | { kind: 'in'; id: string };

/** The letter a name files under: its first folded letter, or # for digits and symbols. */
export function fileLetter(name: string): string {
  const c = normalize(name).charAt(0).toUpperCase();
  return /\p{L}/u.test(c) ? c : '#';
}

/** Things grouped A–Z (# last), each section sorted by name. */
export function browseSections(items: Item[], index: LocationIndex, filter: BrowseFilter): { title: string; data: Item[] }[] {
  const shown = items.filter((i) =>
    filter.kind === 'all' ? true : filter.kind === 'none' ? i.locationId === null : index.isWithin(i.locationId, filter.id),
  );
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  shown.sort((a, b) => collator.compare(a.name, b.name));
  const sections = new Map<string, Item[]>();
  for (const item of shown) {
    const letter = fileLetter(item.name);
    const list = sections.get(letter) ?? [];
    list.push(item);
    sections.set(letter, list);
  }
  return [...sections.entries()]
    .sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : collator.compare(a, b)))
    .map(([title, data]) => ({ title, data }));
}
