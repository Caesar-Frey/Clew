import type { Item, Location } from '../db/types';

import type { LocationIndex } from './locations';

export interface TreeRow {
  place: Location;
  depth: number;
  /** Things here or anywhere inside. */
  count: number;
  hasChildren: boolean;
  expanded: boolean;
}

/** Things in each place, counting everything nested inside it. */
export function nestedCounts(items: Item[], index: LocationIndex): Map<string, number> {
  const direct = new Map<string, number>();
  for (const i of items) if (i.locationId) direct.set(i.locationId, (direct.get(i.locationId) ?? 0) + 1);
  const total = new Map<string, number>();
  const visit = (id: string): number => {
    let n = direct.get(id) ?? 0;
    for (const child of index.children.get(id) ?? []) n += visit(child.id);
    total.set(id, n);
    return n;
  };
  for (const root of index.children.get(null) ?? []) visit(root.id);
  return total;
}

/** The visible rows of the places tree: roots, plus the children of every expanded place. */
export function treeRows(index: LocationIndex, counts: Map<string, number>, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const place of index.children.get(parentId) ?? []) {
      const hasChildren = (index.children.get(place.id)?.length ?? 0) > 0;
      const open = hasChildren && expanded.has(place.id);
      rows.push({ place, depth, count: counts.get(place.id) ?? 0, hasChildren, expanded: open });
      if (open) walk(place.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}
