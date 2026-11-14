import type { Location } from '../db/types';
import { createSearchIndex, normalize, type SearchIndex } from '../search/fuzzy';

import { parsePathInput, PATH_SEPARATOR, type LocationIndex } from './locations';

/**
 * What a place field holds. Places are only ever created through an explicit
 * "Create new place" choice, never from leftover typed text.
 */
export type PlaceValue =
  | { kind: 'none' }
  | { kind: 'existing'; id: string }
  | { kind: 'new'; parentId: string | null; names: string[] };

export const NO_PLACE: PlaceValue = { kind: 'none' };

export type PlaceOption =
  | { kind: 'existing'; id: string; path: string }
  | { kind: 'new'; parentId: string | null; names: string[]; label: string };

export function placeLabel(v: PlaceValue, index: LocationIndex): string {
  if (v.kind === 'existing') return index.pathString(v.id);
  if (v.kind === 'new') return [...index.pathNames(v.parentId), ...v.names].join(PATH_SEPARATOR);
  return '';
}

export function optionValue(o: PlaceOption): PlaceValue {
  return o.kind === 'existing' ? { kind: 'existing', id: o.id } : { kind: 'new', parentId: o.parentId, names: o.names };
}

const fold = (s: string) => normalize(s);

/** A search index over every place by leaf name and by full path. */
export function placeSearchIndex(locations: Location[], index: LocationIndex): SearchIndex<Location> {
  return createSearchIndex(
    locations.map((l) => ({
      value: l,
      rank: l.lastUsedAt,
      fields: [
        { text: l.name, weight: 1 },
        { text: index.pathNames(l.parentId).join(' '), weight: 0.6 },
      ],
    })),
  );
}

/** Children of `parent` whose name folds to the same text as `name`. */
function childNamed(index: LocationIndex, parent: string | null, name: string): Location | undefined {
  const key = fold(name);
  return (index.children.get(parent) ?? []).find((c) => fold(c.name) === key);
}

/**
 * Resolves the longest existing prefix of a typed path. The first part may be
 * any place's leaf name ("Garage > Shelf" finds House › Garage), as long as
 * only one place has that name; then each part must be a child of the last.
 */
function resolvePrefix(names: string[], index: LocationIndex, locations: Location[]): { parentId: string | null; used: number } {
  if (names.length === 0) return { parentId: null, used: 0 };
  let start = childNamed(index, null, names[0]!);
  if (!start) {
    const same = locations.filter((l) => fold(l.name) === fold(names[0]!));
    if (same.length === 1) start = same[0];
  }
  if (!start) return { parentId: null, used: 0 };
  let parent = start.id;
  let used = 1;
  for (const n of names.slice(1)) {
    const next = childNamed(index, parent, n);
    if (!next) break;
    parent = next.id;
    used++;
  }
  return { parentId: parent, used };
}

/**
 * The rows shown under a place field while typing: matching places first
 * (best match on top, which Return picks), then "Create new place" rows.
 * `contextId` is the place the user is working in (e.g. adding from its
 * page); a new single-name place is then offered inside it and at the top
 * level.
 */
export function placeOptions(
  query: string,
  locations: Location[],
  index: LocationIndex,
  search: SearchIndex<Location>,
  opts: { contextId?: string | null; limit?: number } = {},
): PlaceOption[] {
  const names = parsePathInput(query);
  if (names.length === 0) return [];
  const limit = opts.limit ?? 5;
  const typedPath = fold(names.join(' '));
  const out: PlaceOption[] = [];
  const seen = new Set<string>();
  const push = (l: Location) => {
    if (seen.has(l.id) || out.length >= limit) return;
    seen.add(l.id);
    out.push({ kind: 'existing', id: l.id, path: index.pathString(l.id) });
  };

  // An exact path or exact leaf name always comes first.
  const prefix = resolvePrefix(names, index, locations);
  if (prefix.used === names.length && prefix.parentId) push(index.byId.get(prefix.parentId)!);
  if (names.length === 1) {
    locations
      .filter((l) => fold(l.name) === typedPath)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .forEach(push);
  }
  for (const hit of search.search(names.join(' '), limit * 2)) push(hit.value);

  // Offer to create what was typed, unless it already exists exactly.
  const exists = prefix.used === names.length;
  if (!exists) {
    const parentId = prefix.parentId;
    const rest = names.slice(prefix.used);
    const context = opts.contextId && index.byId.has(opts.contextId) ? opts.contextId : null;
    if (names.length === 1 && context && !childNamed(index, context, names[0]!)) {
      out.push({ kind: 'new', parentId: context, names: rest, label: `inside ${index.byId.get(context)!.name}` });
      if (!childNamed(index, null, names[0]!)) out.push({ kind: 'new', parentId: null, names: rest, label: 'at the top level' });
    } else {
      out.push({
        kind: 'new',
        parentId,
        names: rest,
        label: parentId ? `inside ${index.pathString(parentId)}` : names.length > 1 ? 'as a new path' : '',
      });
    }
  }
  return out;
}

/** The place an existing path string points at (below `from`), if every part exists. */
export function findPath(path: string, index: LocationIndex, from: string | null = null): string | null {
  let parent: string | null = from;
  const names = parsePathInput(path);
  if (!names.length) return null;
  for (const n of names) {
    const next = childNamed(index, parent, n);
    if (!next) return null;
    parent = next.id;
  }
  return parent;
}

/** The last two steps of a path, enough to recognise it in a toast. */
export function shortPath(path: string): string {
  return path.split(PATH_SEPARATOR).slice(-2).join(PATH_SEPARATOR);
}

/** The primary button always says what will happen. */
export function saveLabel(opts: { lent: boolean; person: string; place: string }): string {
  if (opts.lent) return `Lend to ${opts.person.trim() || 'someone'}`;
  return opts.place ? `Save to ${shortPath(opts.place)}` : 'Save without a place';
}
