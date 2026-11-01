import { gcm } from '@noble/ciphers/aes.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { randomBytes } from 'node:crypto';

import {
  dumpCatalog,
  NotAnArchiveError,
  openArchive,
  peekArchive,
  restoreCatalog,
  sealArchive,
  toHex,
  WrongPassphraseError,
  type Aead,
  type ArchiveDeps,
} from '../src/backup/archive';
import { testRepo } from './testDb';

const aead: Aead = {
  seal: async (key, nonce, data, aad) => gcm(key, nonce, aad).encrypt(data),
  open: async (key, nonce, data, aad) => gcm(key, nonce, aad).decrypt(data),
};
// Cheap KDF so tests stay fast; the format records whatever was used.
const deps: ArchiveDeps = { aead, randomBytes: (n) => new Uint8Array(randomBytes(n)), kdf: { N: 1024, r: 8, p: 1 } };

async function sampleCatalog() {
  const t = await testRepo();
  const box = await t.repo.ensureLocationPath(['House', 'Garage', 'Blue box']);
  const drill = await t.repo.addItem({ name: 'Drill', locationId: box, tags: ['tools'], notes: 'Bosch' });
  await t.repo.addItem({ name: 'Ladder', placeNames: ['House', 'Shed'], lendTo: { person: 'Sam', dueAt: 5 } });
  await t.repo.moveItem(drill, null);
  await t.repo.setSetting('reminders.on', '1');
  await t.repo.setSetting('device.notificationIds', '["x"]');
  await t.db.runAsync('UPDATE items SET embedding = ? WHERE id = ?', [new Uint8Array([1, 2, 255]), drill]);
  return t;
}

describe('archive', () => {
  it('round-trips the whole catalog into a fresh database', async () => {
    const source = await sampleCatalog();
    const file = await sealArchive(await dumpCatalog(source.db, 42), 'correct horse battery', deps);

    expect(peekArchive(file)).toEqual({ createdAt: 42, summary: { items: 2, places: 4, photos: 0 } });

    const target = await testRepo();
    await target.repo.addItem({ name: 'Will be replaced', placeNames: ['Old'] });
    await restoreCatalog(target.db, await openArchive(file, 'correct horse battery', deps));

    expect(await target.repo.listItems()).toEqual(await source.repo.listItems());
    expect(await target.repo.listLocations()).toEqual(await source.repo.listLocations());
    const drill = (await source.repo.listItems()).find((i) => i.name === 'Drill')!;
    expect(await target.repo.itemHistory(drill.id)).toEqual(await source.repo.itemHistory(drill.id));
    expect(await target.repo.getSetting('reminders.on')).toBe('1');
    // Device-only settings don't travel.
    expect(await target.repo.getSetting('device.notificationIds')).toBeNull();
    const emb = await target.db.getFirstAsync<{ embedding: Uint8Array }>('SELECT embedding FROM items WHERE id = ?', [drill.id]);
    expect([...emb!.embedding]).toEqual([1, 2, 255]);
  });

  it('rejects a wrong passphrase and any tampering', async () => {
    const { db } = await sampleCatalog();
    const file = await sealArchive(await dumpCatalog(db, 1), 'correct horse battery', deps);
    await expect(openArchive(file, 'Correct horse battery', deps)).rejects.toBeInstanceOf(WrongPassphraseError);

    const flippedBody = file.slice();
    flippedBody[flippedBody.length - 20]! ^= 1;
    await expect(openArchive(flippedBody, 'correct horse battery', deps)).rejects.toBeInstanceOf(WrongPassphraseError);

    // Editing the readable header (e.g. the summary) also breaks the seal.
    const edited = file.slice();
    const at = Buffer.from(edited).indexOf('"items":2');
    expect(at).toBeGreaterThan(0);
    edited[at + 8] = '9'.charCodeAt(0);
    await expect(openArchive(edited, 'correct horse battery', deps)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('still opens backups made when the app was called Whereabouts', async () => {
    const source = await sampleCatalog();
    const dump = { ...(await dumpCatalog(source.db, 7)), format: 'whereabouts-catalog' as const };
    // Built byte for byte the way the Whereabouts builds wrote archives.
    const salt = new Uint8Array(randomBytes(16));
    const nonce = new Uint8Array(randomBytes(12));
    const header = new TextEncoder().encode(
      JSON.stringify({ app: 'whereabouts', kdf: 'scrypt', N: 1024, r: 8, p: 1, salt: toHex(salt), nonce: toHex(nonce), createdAt: 7, summary: { items: 2, places: 4, photos: 0 } }),
    );
    const prefix = new Uint8Array(9 + header.length);
    prefix.set([0x57, 0x48, 0x42, 0x4b], 0); // "WHBK"
    prefix[4] = 1;
    new DataView(prefix.buffer).setUint32(5, header.length);
    prefix.set(header, 9);
    const key = scrypt('correct horse battery', salt, { N: 1024, r: 8, p: 1, dkLen: 32 });
    const body = gcm(key, nonce, prefix).encrypt(new TextEncoder().encode(JSON.stringify(dump)));
    const legacy = new Uint8Array(prefix.length + body.length);
    legacy.set(prefix, 0);
    legacy.set(body, prefix.length);

    expect(peekArchive(legacy).createdAt).toBe(7);
    const target = await testRepo();
    await restoreCatalog(target.db, await openArchive(legacy, 'correct horse battery', deps));
    expect(await target.repo.listItems()).toEqual(await source.repo.listItems());
  });

  it('writes new backups under the Clew name', async () => {
    const { db } = await sampleCatalog();
    const file = await sealArchive(await dumpCatalog(db, 1), 'correct horse battery', deps);
    expect(Buffer.from(file.subarray(0, 4)).toString()).toBe('CLEW');
    expect(Buffer.from(file).includes('"app":"clew"')).toBe(true);
    expect((await openArchive(file, 'correct horse battery', deps)).format).toBe('clew-catalog');
  });

  it('refuses short passphrases and files that are not archives', async () => {
    const { db } = await sampleCatalog();
    await expect(sealArchive(await dumpCatalog(db, 1), 'short', deps)).rejects.toThrow(/at least/);
    await expect(openArchive(new TextEncoder().encode('hello there, not a backup'), 'whatever!', deps)).rejects.toBeInstanceOf(
      NotAnArchiveError,
    );
  });

  it('leaves the catalog untouched when a restore fails part-way', async () => {
    const source = await sampleCatalog();
    const dump = await dumpCatalog(source.db, 1);
    dump.tables.items!.push({ ...dump.tables.items![0]! }); // duplicate primary key
    const target = await testRepo();
    await target.repo.addItem({ name: 'Keep me', placeNames: ['Drawer'] });
    await expect(restoreCatalog(target.db, dump)).rejects.toThrow();
    expect((await target.repo.listItems()).map((i) => i.name)).toEqual(['Keep me']);
  });
});
