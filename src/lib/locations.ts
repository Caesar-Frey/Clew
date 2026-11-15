import type { Location } from '../db/types';

export const PATH_SEPARATOR = ' › ';

/**
 * "House > Garage › Blue box" -> ["House", "Garage", "Blue box"]. Only ">" and
 * "›" separate places, so names like "TV/Media shelf" survive.
 */
export function parsePathInput(input: string): string[] {
  return input
    .split(/[>›]/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length > 0);
}

export interface LocationIndex {
  byId: Map<string, Location>;
  children: Map<string | null, Location[]>;
  /** Names from the root down to `id`. */
  pathNames(id: string | null): string[];
  pathString(id: string | null): string;
  /** True if `id` is `ancestorId` or sits somewhere below it. */
  isWithin(id: string | null, ancestorId: string): boolean;
  /** `id` plus every place nested below it. */
  subtreeIds(id: string): Set<string>;
}

export function buildLocationIndex(locations: Location[]): LocationIndex {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const children = new Map<string | null, Location[]>();
  for (const loc of locations) {
    const parent = loc.parentId && byId.has(loc.parentId) ? loc.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(loc);
    children.set(parent, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  const pathCache = new Map<string, string[]>();
  function pathNames(id: string | null): string[] {
    if (!id) return [];
    const cached = pathCache.get(id);
    if (cached) return cached;
    const names: string[] = [];
    const seen = new Set<string>();
    let cur = byId.get(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      names.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    pathCache.set(id, names);
    return names;
  }

  function isWithin(id: string | null, ancestorId: string): boolean {
    const seen = new Set<string>();
    let cur = id ? byId.get(id) : undefined;
    while (cur && !seen.has(cur.id)) {
      if (cur.id === ancestorId) return true;
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  }

  function subtreeIds(id: string): Set<string> {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const next = stack.pop()!;
      if (out.has(next)) continue;
      out.add(next);
      for (const child of children.get(next) ?? []) stack.push(child.id);
    }
    return out;
  }

  return {
    byId,
    children,
    pathNames,
    pathString: (id) => pathNames(id).join(PATH_SEPARATOR),
    isWithin,
    subtreeIds,
  };
}
