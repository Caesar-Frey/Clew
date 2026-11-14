import { MIGRATIONS, migrate } from '../src/db/schema';
import { createRepo } from '../src/db/repo';
import { memoryDb } from './testDb';

/** A database as the first release left it: schema v1 with some data in it. */
async function v1Database() {
  const db = memoryDb();
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync(MIGRATIONS[0]!);
  await db.execAsync('PRAGMA user_version = 1');
  await db.execAsync(`
    INSERT INTO locations (id, name, parent_id, created_at, last_used_at) VALUES
      ('house', 'House', NULL, 1000, 1000),
      ('garage', 'Garage', 'house', 1000, 2000);
    INSERT INTO items (id, name, notes, location_id, created_at, updated_at) VALUES
      ('drill', 'Drill', 'Bosch', 'garage', 1000, 3000),
      ('ladder', 'Ladder', NULL, NULL, 1000, 1000);
    INSERT INTO tags (id, name) VALUES ('t1', 'tools');
    INSERT INTO item_tags (item_id, tag_id, source) VALUES ('drill', 't1', 'user');
    INSERT INTO loans (id, item_id, person, lent_at, due_at) VALUES ('l1', 'ladder', 'Sam', 1500, 9000);
    INSERT INTO moves (id, item_id, from_location_id, to_location_id, from_path, to_path, moved_at) VALUES
      ('m1', 'drill', NULL, 'garage', NULL, 'House › Garage', 3000);
    INSERT INTO photos (id, item_id, uri, kind, created_at) VALUES ('p1', 'drill', 'file:///old/drill.jpg', 'item', 1200);
    INSERT INTO settings (key, value) VALUES ('reminders.on', '1');
  `);
  return db;
}

describe('migrations from v1 data', () => {
  it('brings a v1 catalog up to date without losing anything', async () => {
    const db = await v1Database();
    await migrate(db);
    expect((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version).toBe(MIGRATIONS.length);

    let n = 0;
    const repo = createRepo(db, { now: () => 10_000, uuid: () => `new-${++n}` });
    const items = await repo.listItems();
    const drill = items.find((i) => i.name === 'Drill')!;
    const ladder = items.find((i) => i.name === 'Ladder')!;
    expect(drill).toMatchObject({ locationId: 'garage', notes: 'Bosch', tags: ['tools'] });
    expect(ladder.activeLoan).toMatchObject({ person: 'Sam', dueAt: 9000 });
    expect((await repo.listLocations()).map((l) => l.name).sort()).toEqual(['Garage', 'House']);
    expect((await repo.itemHistory('drill')).map((h) => h.kind)).toContain('moved');
    expect(await repo.getSetting('reminders.on')).toBe('1');
    // A v1 photo had only a file uri; it has no stored data, so it reads as missing rather than crashing.
    expect(await repo.getPhoto('p1')).toBeNull();
  });

  it('keeps working after the upgrade: new photos, moves and loans', async () => {
    const db = await v1Database();
    await migrate(db);
    let n = 0;
    const repo = createRepo(db, { now: () => 20_000 + n, uuid: () => `new-${++n}` });
    const photoId = await repo.addPhoto({ itemId: 'drill' }, { data: 'AAAA', thumb: 'AA', width: 4, height: 3 });
    expect(await repo.getPhoto(photoId)).toMatchObject({ data: 'AAAA', width: 4 });
    await repo.moveItem('drill', 'house');
    await repo.returnItem('ladder');
    const items = await repo.listItems();
    expect(items.find((i) => i.name === 'Drill')!.locationId).toBe('house');
    expect(items.find((i) => i.name === 'Ladder')!.activeLoan).toBeNull();
  });

  it('runs each step at most once and refuses a database from a newer app', async () => {
    const db = await v1Database();
    await migrate(db);
    await migrate(db);
    expect((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version).toBe(MIGRATIONS.length);
    await db.execAsync(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    await expect(migrate(db)).rejects.toThrow(/newer than this app/);
  });
});
