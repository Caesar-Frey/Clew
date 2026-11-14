import { decodeFingerprint, MAX_VIEWS } from '../src/boxes/fingerprint';
import { buildLocationIndex } from '../src/lib/locations';
import { MIGRATIONS, migrate } from '../src/db/schema';
import { testRepo } from './testDb';

describe('schema', () => {
  it('migrates idempotently', async () => {
    const { db } = await testRepo();
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(MIGRATIONS.length);
  });
});

describe('locations', () => {
  it('reuses existing places case-insensitively and nests new ones', async () => {
    const { repo } = await testRepo();
    const box = await repo.ensureLocationPath(['House', 'Garage', 'Blue box']);
    const again = await repo.ensureLocationPath(['house', 'GARAGE', 'blue  box ']);
    expect(again).toBe(box);
    const shelf = await repo.ensureLocationPath(['House', 'Garage', 'Shelf']);
    const index = buildLocationIndex(await repo.listLocations());
    expect(index.pathString(shelf)).toBe('House › Garage › Shelf');
    expect((await repo.listLocations()).length).toBe(4);
  });

  it('refuses to put a place inside itself', async () => {
    const { repo } = await testRepo();
    const box = await repo.ensureLocationPath(['House', 'Garage', 'Box']);
    const locs = await repo.listLocations();
    const house = locs.find((l) => l.name === 'House')!;
    await expect(repo.setLocationParent(house.id, box)).rejects.toThrow(/inside itself/);
  });

  it('deleting a place moves its contents up and keeps history readable', async () => {
    const { repo } = await testRepo();
    const box = await repo.ensureLocationPath(['House', 'Garage', 'Box']);
    await repo.ensureLocationPath(['House', 'Garage', 'Box', 'Bag']);
    const item = await repo.addItem({ name: 'Drill', locationId: box });
    const garage = (await repo.listLocations()).find((l) => l.name === 'Garage')!;
    await repo.deleteLocation(box);

    const items = await repo.listItems();
    expect(items[0]!.locationId).toBe(garage.id);
    const index = buildLocationIndex(await repo.listLocations());
    const bag = [...index.byId.values()].find((l) => l.name === 'Bag')!;
    expect(bag.parentId).toBe(garage.id);

    const history = await repo.itemHistory(item);
    expect(history[0]).toMatchObject({ kind: 'moved', fromPath: 'House › Garage › Box', toPath: 'House › Garage' });
  });

  it('merges a child into a same-named sibling when its parent is deleted', async () => {
    const { repo } = await testRepo();
    const innerShelf = await repo.ensureLocationPath(['Garage', 'Cupboard', 'Shelf']);
    const outerShelf = await repo.ensureLocationPath(['Garage', 'Shelf']);
    await repo.addItem({ name: 'Glue', locationId: innerShelf });
    const cupboard = (await repo.listLocations()).find((l) => l.name === 'Cupboard')!;
    await repo.deleteLocation(cupboard.id);
    const items = await repo.listItems();
    expect(items[0]!.locationId).toBe(outerShelf);
    expect((await repo.listLocations()).map((l) => l.name).sort()).toEqual(['Garage', 'Shelf']);
  });

  it('keeps contents when deleting a place whose child has the same name', async () => {
    const { repo } = await testRepo();
    const inner = await repo.ensureLocationPath(['Garage', 'Box', 'Box']);
    await repo.ensureLocationPath(['Garage', 'Box', 'Box', 'Bag']);
    const id = await repo.addItem({ name: 'Glue', locationId: inner });
    const garage = (await repo.listLocations()).find((l) => l.name === 'Garage')!;
    const outer = (await repo.listLocations()).find((l) => l.name === 'Box' && l.parentId === garage.id)!;
    await repo.deleteLocation(outer.id);

    const index = buildLocationIndex(await repo.listLocations());
    const [item] = await repo.listItems();
    expect(item!.id).toBe(id);
    expect(index.pathString(item!.locationId)).toBe('Garage › Box');
    const bag = [...index.byId.values()].find((l) => l.name === 'Bag')!;
    expect(index.pathString(bag.id)).toBe('Garage › Box › Bag');
  });

  it('rename rejects a clash with a sibling', async () => {
    const { repo } = await testRepo();
    const a = await repo.ensureLocationPath(['Garage', 'A']);
    await repo.ensureLocationPath(['Garage', 'B']);
    await expect(repo.renameLocation(a, 'b')).rejects.toThrow(/already/);
  });
});

describe('items', () => {
  it('adds an item with tags and records where it was put', async () => {
    const { repo } = await testRepo();
    const drawer = await repo.ensureLocationPath(['Kitchen', 'Drawer']);
    const id = await repo.addItem({ name: '  Spare   keys ', locationId: drawer, tags: ['keys', '#Keys', 'car'] });
    const [item] = await repo.listItems();
    expect(item).toMatchObject({ id, name: 'Spare keys', locationId: drawer });
    expect(item!.tags.sort()).toEqual(['car', 'keys']);
    const history = await repo.itemHistory(id);
    expect(history).toEqual([expect.objectContaining({ kind: 'moved', fromPath: null, toPath: 'Kitchen › Drawer' })]);
  });

  it('creates the place path and the loan together with the item', async () => {
    const { repo } = await testRepo();
    const id = await repo.addItem({ name: 'Tent', placeNames: ['Garage', 'Shelf'], lendTo: { person: 'Sam', dueAt: 9 } });
    const [item] = await repo.listItems();
    const index = buildLocationIndex(await repo.listLocations());
    expect(index.pathString(item!.locationId)).toBe('Garage › Shelf');
    expect(item!.activeLoan).toMatchObject({ itemId: id, person: 'Sam', dueAt: 9 });
  });

  it('creates a chosen new place inside the given parent, not at the top level', async () => {
    const { repo } = await testRepo();
    const garage = await repo.ensureLocationPath(['House', 'Garage']);
    await repo.addItem({ name: 'Drill', placeNames: ['Blue box'], placeParentId: garage });
    const [item] = await repo.listItems();
    const index = buildLocationIndex(await repo.listLocations());
    expect(index.pathString(item!.locationId)).toBe('House › Garage › Blue box');
    expect(index.children.get(null)!.map((l) => l.name)).toEqual(['House']);
  });

  it('saves nothing when part of an add fails, so retrying cannot duplicate', async () => {
    const { repo } = await testRepo();
    await expect(
      repo.addItem({ name: 'Tent', placeNames: ['Garage', 'x'.repeat(500)] }),
    ).rejects.toThrow(/too long/);
    await expect(repo.addItem({ name: 'Tent', placeNames: ['Garage'], lendTo: { person: '  ' } })).rejects.toThrow(
      /Person/,
    );
    expect(await repo.listItems()).toEqual([]);
    expect(await repo.listLocations()).toEqual([]);
  });

  it('rejects empty names', async () => {
    const { repo } = await testRepo();
    await expect(repo.addItem({ name: '   ', locationId: null })).rejects.toThrow(/name/);
  });

  it('moves an item and keeps the full history newest first', async () => {
    const { repo } = await testRepo();
    const a = await repo.ensureLocationPath(['Garage']);
    const b = await repo.ensureLocationPath(['Attic']);
    const id = await repo.addItem({ name: 'Tent', locationId: a });
    expect(await repo.moveItem(id, b)).toEqual(expect.any(String));
    expect(await repo.moveItem(id, b)).toBeNull();
    const history = await repo.itemHistory(id);
    expect(history.map((h) => h.kind === 'moved' && h.toPath)).toEqual(['Attic', 'Garage']);
  });

  it('removes orphaned tags on update and delete', async () => {
    const { repo, db } = await testRepo();
    const id = await repo.addItem({ name: 'Tent', locationId: null, tags: ['camping'] });
    await repo.updateItem(id, { tags: ['outdoor'] });
    expect(await db.getAllAsync('SELECT name FROM tags')).toEqual([{ name: 'outdoor' }]);
    await repo.deleteItem(id);
    expect(await db.getAllAsync('SELECT name FROM tags')).toEqual([]);
    expect(await db.getAllAsync('SELECT * FROM moves')).toEqual([]);
  });
});

describe('loans', () => {
  it('tracks one active loan per item and its return', async () => {
    const { repo } = await testRepo();
    const id = await repo.addItem({ name: 'Ladder', locationId: null });
    await repo.lendItem(id, { person: 'Sam', dueAt: 5_000_000 });
    await expect(repo.lendItem(id, { person: 'Alex' })).rejects.toThrow(/Already lent to Sam/);
    let [item] = await repo.listItems();
    expect(item!.activeLoan).toMatchObject({ person: 'Sam', dueAt: 5_000_000 });

    await repo.returnItem(id);
    [item] = await repo.listItems();
    expect(item!.activeLoan).toBeNull();
    await repo.lendItem(id, { person: 'Alex' });

    const kinds = (await repo.itemHistory(id)).map((h) => h.kind);
    expect(kinds).toEqual(['lent', 'returned', 'lent']);
    expect(await repo.knownPeople()).toEqual(['Alex', 'Sam']);
  });
});

describe('settings', () => {
  it('upserts', async () => {
    const { repo } = await testRepo();
    expect(await repo.getSetting('x')).toBeNull();
    await repo.setSetting('x', '1');
    await repo.setSetting('x', '2');
    expect(await repo.getSetting('x')).toBe('2');
  });
});

describe('undo', () => {
  it('takes a move back and drops it from the history', async () => {
    const { repo } = await testRepo();
    const a = await repo.ensureLocationPath(['A']);
    const b = await repo.ensureLocationPath(['B']);
    const id = await repo.addItem({ name: 'Drill', locationId: a });
    const moveId = await repo.moveItem(id, b);
    expect(await repo.moveItem(id, b)).toBeNull();
    await repo.undoMove(moveId!);
    expect((await repo.listItems())[0]!.locationId).toBe(a);
    expect((await repo.itemHistory(id)).map((h) => h.kind)).toEqual(['moved']);
  });

  it("doesn't undo a move once the item has moved again", async () => {
    const { repo } = await testRepo();
    const [a, b, c] = [await repo.ensureLocationPath(['A']), await repo.ensureLocationPath(['B']), await repo.ensureLocationPath(['C'])];
    const id = await repo.addItem({ name: 'Drill', locationId: a });
    const first = await repo.moveItem(id, b);
    await repo.moveItem(id, c);
    await repo.undoMove(first!);
    expect((await repo.listItems())[0]!.locationId).toBe(c);
  });

  it('re-opens a returned loan', async () => {
    const { repo } = await testRepo();
    const id = await repo.addItem({ name: 'Book', lendTo: { person: 'Sam', dueAt: 99 } });
    const loanId = await repo.returnItem(id);
    expect((await repo.listItems())[0]!.activeLoan).toBeNull();
    await repo.undoReturn(loanId!);
    expect((await repo.listItems())[0]!.activeLoan).toMatchObject({ person: 'Sam', dueAt: 99 });
    expect(await repo.returnItem('nope')).toBeNull();
  });

  it('restores a withdrawn item with its tags, loans and history', async () => {
    const { repo } = await testRepo();
    const a = await repo.ensureLocationPath(['A']);
    const b = await repo.ensureLocationPath(['B']);
    const id = await repo.addItem({ name: 'Tent', locationId: a, tags: ['camping'], notes: 'green' });
    await repo.moveItem(id, b);
    await repo.lendItem(id, { person: 'Sam' });
    const before = await repo.listItems();
    const history = await repo.itemHistory(id);
    const snap = await repo.deleteItem(id);
    expect(await repo.listItems()).toEqual([]);
    await repo.restoreItem(snap!);
    expect(await repo.listItems()).toEqual(before);
    expect(await repo.itemHistory(id)).toEqual(history);
  });

  it('restores an item as unshelved if its place is gone', async () => {
    const { repo } = await testRepo();
    const a = await repo.ensureLocationPath(['A']);
    const id = await repo.addItem({ name: 'Tent', locationId: a });
    const snap = await repo.deleteItem(id);
    await repo.deleteLocation(a);
    await repo.restoreItem(snap!);
    expect((await repo.listItems())[0]!.locationId).toBeNull();
  });
});

describe('photos', () => {
  const photo = (n: number) => ({ data: `full${n}`, thumb: `thumb${n}`, width: 1600, height: 1200 });

  it('stores photos with an item, uses the first as cover, and survives withdraw + undo', async () => {
    const { repo } = await testRepo();
    const id = await repo.addItem({ name: 'Tent', placeNames: ['Attic'], photos: [photo(1)] });
    const second = await repo.addPhoto({ itemId: id }, photo(2));
    let [item] = await repo.listItems();
    expect(item!.photoIds).toHaveLength(2);
    expect(item!.cover).toBe('thumb1');
    expect((await repo.getPhoto(second))?.data).toBe('full2');

    const snap = await repo.deleteItem(id);
    expect(await repo.getPhoto(second)).toBeNull();
    await repo.restoreItem(snap!);
    [item] = await repo.listItems();
    expect(item!.photoIds).toHaveLength(2);

    await repo.deletePhoto(item!.photoIds[0]!);
    [item] = await repo.listItems();
    expect(item!.cover).toBe('thumb2');
  });
});

describe('boxes', () => {
  it('keeps fingerprints and box photos per place, and forgets them together', async () => {
    const { repo } = await testRepo();
    const box = await repo.ensureLocationPath(['Garage', 'Blue box']);
    await repo.setFingerprint(box, new Uint8Array([1, 2, 3]), 'wb-fp-1');
    await repo.addPhoto({ locationId: box }, { data: 'd', thumb: 't', width: 1, height: 1, kind: 'box' });
    const [info] = await repo.listBoxes();
    expect(info).toMatchObject({ locationId: box, cover: 't' });
    expect([...info!.fingerprint!]).toEqual([1, 2, 3]);
    await repo.clearBox(box);
    expect(await repo.listBoxes()).toEqual([]);
  });

  it('deletes the photo of a view that falls off the cap, with the fingerprint, in one go', async () => {
    const { repo } = await testRepo();
    const box = await repo.ensureLocationPath(['Garage', 'Blue box']);
    const v = (n: number) => ({ words: n % 2 ? ['camping'] : [], text: '', hist: [n], grid: [] });
    const ids: string[] = [];
    for (let i = 0; i < MAX_VIEWS + 2; i++) {
      ids.push(await repo.addBoxView(box, v(i), { data: `d${i}`, thumb: `t${i}`, width: 1, height: 1 }));
    }
    const [info] = await repo.listBoxes();
    const fp = decodeFingerprint(info!.fingerprint)!;
    expect(fp.views).toHaveLength(MAX_VIEWS);
    expect(info!.photoIds).toHaveLength(MAX_VIEWS);
    expect(new Set(info!.photoIds)).toEqual(new Set(fp.views.map((x) => x.photoId)));
    expect(await repo.getPhoto(ids[0]!)).toBeNull();
    expect(await repo.getPhoto(ids.at(-1)!)).not.toBeNull();
    await expect(repo.addBoxView('nope', v(1), { data: 'd', thumb: 't', width: 1, height: 1 })).rejects.toThrow(/no longer exists/);
  });
});

describe('assistant data', () => {
  it('remembers which subjects came from the assistant, across edits', async () => {
    const { db, repo } = await testRepo();
    const id = await repo.addItem({ name: 'Drill', tags: ['tools'], aiTags: ['power tool'] });
    await repo.updateItem(id, { tags: ['tools', 'power tool', 'garage'] });
    const rows = await db.getAllAsync<{ name: string; source: string }>(
      'SELECT t.name, it.source FROM item_tags it JOIN tags t ON t.id = it.tag_id ORDER BY t.name',
    );
    expect(rows).toEqual([
      { name: 'garage', source: 'user' },
      { name: 'power tool', source: 'ai' },
      { name: 'tools', source: 'user' },
    ]);
  });

  it('marks embeddings stale when the item changes', async () => {
    const { repo } = await testRepo();
    const id = await repo.addItem({ name: 'Drill' });
    expect(await repo.staleEmbeddings('m')).toEqual([id]);
    await repo.setEmbedding(id, new Uint8Array(8), 'm');
    expect(await repo.staleEmbeddings('m')).toEqual([]);
    expect(await repo.listEmbeddings('m')).toHaveLength(1);
    expect(await repo.staleEmbeddings('other')).toEqual([id]);
    await repo.updateItem(id, { notes: 'Bosch' });
    expect(await repo.staleEmbeddings('m')).toEqual([id]);
    expect(await repo.listEmbeddings('m')).toHaveLength(0);
  });
});
