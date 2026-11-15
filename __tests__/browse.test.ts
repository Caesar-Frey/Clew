import type { Item, Location } from '../src/db/types';
import { browseSections, fileLetter } from '../src/lib/browse';
import { buildLocationIndex } from '../src/lib/locations';

const item = (id: string, name: string, locationId: string | null) =>
  ({ id, name, locationId, notes: null, createdAt: 0, updatedAt: 0, tags: [], activeLoan: null, photoIds: [], cover: null }) as Item;

describe('A–Z browse', () => {
  const locations = [
    { id: 'house', name: 'House', parentId: null },
    { id: 'garage', name: 'Garage', parentId: 'house' },
    { id: 'office', name: 'Office', parentId: null },
  ] as Location[];
  const index = buildLocationIndex(locations);
  const items = [
    item('1', 'drill', 'garage'),
    item('2', 'Éclair tin', 'house'),
    item('3', '3D glasses', null),
    item('4', 'Adapter', 'office'),
    item('5', 'Łopata', 'garage'),
    item('6', 'Desk lamp', 'office'),
  ];

  it('files names under folded letters, digits under #', () => {
    expect(fileLetter('Éclair')).toBe('E');
    expect(fileLetter('łopata')).toBe('L');
    expect(fileLetter('3D glasses')).toBe('#');
  });

  it('groups A–Z with # last and sorts within a letter', () => {
    const s = browseSections(items, index, { kind: 'all' });
    expect(s.map((x) => x.title)).toEqual(['A', 'D', 'E', 'L', '#']);
    expect(s.find((x) => x.title === 'D')!.data.map((i) => i.name)).toEqual(['Desk lamp', 'drill']);
  });

  it('filters by place (including nested places) or by no place', () => {
    const inHouse = browseSections(items, index, { kind: 'in', id: 'house' }).flatMap((x) => x.data.map((i) => i.id));
    expect(inHouse.sort()).toEqual(['1', '2', '5']);
    expect(browseSections(items, index, { kind: 'none' }).flatMap((x) => x.data.map((i) => i.id))).toEqual(['3']);
  });
});
