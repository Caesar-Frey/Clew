import type { Item, Location } from '../src/db/types';
import { buildLocationIndex } from '../src/lib/locations';
import { nestedCounts, treeRows } from '../src/lib/placeTree';

const loc = (id: string, name: string, parentId: string | null) => ({ id, name, parentId, createdAt: 0, lastUsedAt: 0 }) as Location;
const item = (id: string, locationId: string | null) => ({ id, name: id, locationId }) as Item;

describe('places tree', () => {
  const index = buildLocationIndex([
    loc('house', 'House', null),
    loc('garage', 'Garage', 'house'),
    loc('box', 'Blue box', 'garage'),
    loc('office', 'Office', null),
  ]);
  const counts = nestedCounts([item('a', 'box'), item('b', 'box'), item('c', 'garage'), item('d', 'house'), item('e', null)], index);

  it('counts things in nested places', () => {
    expect(counts.get('house')).toBe(4);
    expect(counts.get('garage')).toBe(3);
    expect(counts.get('box')).toBe(2);
    expect(counts.get('office')).toBe(0);
  });

  it('shows roots, and children only under expanded places', () => {
    expect(treeRows(index, counts, new Set()).map((r) => r.place.id)).toEqual(['house', 'office']);
    const open = treeRows(index, counts, new Set(['house', 'garage']));
    expect(open.map((r) => [r.place.id, r.depth])).toEqual([
      ['house', 0],
      ['garage', 1],
      ['box', 2],
      ['office', 0],
    ]);
    expect(open.find((r) => r.place.id === 'box')!.hasChildren).toBe(false);
  });
});
