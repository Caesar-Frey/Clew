import { buildLocationIndex, PATH_SEPARATOR } from '../lib/locations';
import type { BoxInfo, Db, HistoryEvent, Item, Loan, Location, Photo, PhotoInput, SqlValue } from './types';

/** Everything needed to put a deleted item back. */
export interface ItemSnapshot {
  item: Record<string, SqlValue>;
  tags: { name: string; source: string }[];
  photos: Record<string, SqlValue>[];
  loans: Record<string, SqlValue>[];
  moves: Record<string, SqlValue>[];
}

export interface RepoDeps {
  now: () => number;
  uuid: () => string;
}

interface LocationRow {
  id: string;
  name: string;
  parent_id: string | null;
  notes: string | null;
  created_at: number;
  last_used_at: number;
}

interface ItemRow {
  id: string;
  name: string;
  notes: string | null;
  location_id: string | null;
  created_at: number;
  updated_at: number;
}

interface LoanRow {
  id: string;
  item_id: string;
  person: string;
  lent_at: number;
  due_at: number | null;
  returned_at: number | null;
  notes: string | null;
}

const toLocation = (r: LocationRow): Location => ({
  id: r.id,
  name: r.name,
  parentId: r.parent_id,
  notes: r.notes,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
});

const toLoan = (r: LoanRow): Loan => ({
  id: r.id,
  itemId: r.item_id,
  person: r.person,
  lentAt: r.lent_at,
  dueAt: r.due_at,
  returnedAt: r.returned_at,
  notes: r.notes,
});

export const MAX_NAME_LENGTH = 200;
export const MAX_NOTES_LENGTH = 5000;

function cleanName(name: string, what: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error(`${what} needs a name`);
  if (clean.length > MAX_NAME_LENGTH) throw new Error(`${what} name is too long`);
  return clean;
}

function cleanNotes(notes: string | null | undefined): string | null {
  const clean = notes?.trim() ?? '';
  if (clean.length > MAX_NOTES_LENGTH) throw new Error('Notes are too long');
  return clean || null;
}

function cleanTags(tags: string[] | undefined): string[] {
  const seen = new Map<string, string>();
  for (const t of tags ?? []) {
    const clean = t.trim().replace(/^#/, '').replace(/\s+/g, ' ');
    if (clean && clean.length <= 50 && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
  }
  return [...seen.values()];
}

export type Repo = ReturnType<typeof createRepo>;

export function createRepo(db: Db, deps: RepoDeps) {
  const { now, uuid } = deps;

  async function listLocations(): Promise<Location[]> {
    const rows = await db.getAllAsync<LocationRow>('SELECT * FROM locations');
    return rows.map(toLocation);
  }

  async function pathString(locationId: string | null): Promise<string | null> {
    if (!locationId) return null;
    const index = buildLocationIndex(await listLocations());
    return index.byId.has(locationId) ? index.pathString(locationId) : null;
  }

  async function touchLocation(id: string | null): Promise<void> {
    if (!id) return;
    // Bump the place and its parents so the whole path stays "recent".
    await db.runAsync(
      `WITH RECURSIVE up(id) AS (
         SELECT ? UNION SELECT l.parent_id FROM locations l JOIN up ON l.id = up.id
         WHERE l.parent_id IS NOT NULL)
       UPDATE locations SET last_used_at = ? WHERE id IN (SELECT id FROM up)`,
      [id, now()],
    );
  }

  /**
   * Finds or creates each place along `names` (root first) and returns the
   * deepest one. `parentId` lets the path start below an existing place.
   */
  async function ensureLocationPath(names: string[], parentId: string | null = null): Promise<string> {
    if (names.length === 0) throw new Error('Where is it? Add a place');
    let parent = parentId;
    for (const raw of names) {
      const name = cleanName(raw, 'Place');
      const existing = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM locations WHERE ifnull(parent_id, '') = ifnull(?, '') AND name = ? COLLATE NOCASE`,
        [parent, name],
      );
      if (existing) {
        parent = existing.id;
        continue;
      }
      const id = uuid();
      const t = now();
      await db.runAsync(
        'INSERT INTO locations (id, name, parent_id, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)',
        [id, name, parent, t, t],
      );
      parent = id;
    }
    return parent!;
  }

  async function renameLocation(id: string, name: string): Promise<void> {
    const clean = cleanName(name, 'Place');
    const loc = await db.getFirstAsync<LocationRow>('SELECT * FROM locations WHERE id = ?', [id]);
    if (!loc) throw new Error('That place no longer exists');
    const clash = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM locations WHERE ifnull(parent_id, '') = ifnull(?, '') AND name = ? COLLATE NOCASE AND id != ?`,
      [loc.parent_id, clean, id],
    );
    if (clash) throw new Error(`There's already a place called "${clean}" here`);
    await db.runAsync('UPDATE locations SET name = ? WHERE id = ?', [clean, id]);
  }

  async function setLocationParent(id: string, parentId: string | null): Promise<void> {
    if (parentId) {
      const index = buildLocationIndex(await listLocations());
      if (index.isWithin(parentId, id)) throw new Error("A place can't go inside itself");
    }
    const loc = await db.getFirstAsync<LocationRow>('SELECT * FROM locations WHERE id = ?', [id]);
    if (!loc) throw new Error('That place no longer exists');
    const clash = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM locations WHERE ifnull(parent_id, '') = ifnull(?, '') AND name = ? COLLATE NOCASE AND id != ?`,
      [parentId, loc.name, id],
    );
    if (clash) throw new Error(`There's already a place called "${loc.name}" there`);
    await db.runAsync('UPDATE locations SET parent_id = ? WHERE id = ?', [parentId, id]);
  }

  /**
   * Deletes a place. Whatever was inside it (items and nested places) moves
   * up to the parent, so nothing is lost.
   */
  async function deleteLocation(id: string): Promise<void> {
    const loc = await db.getFirstAsync<LocationRow>('SELECT * FROM locations WHERE id = ?', [id]);
    if (!loc) return;
    const fromPath = await pathString(id);
    const toPath = await pathString(loc.parent_id);
    await db.withTransactionAsync(async () => {
      const items = await db.getAllAsync<{ id: string }>('SELECT id FROM items WHERE location_id = ?', [id]);
      const t = now();
      for (const item of items) {
        await db.runAsync(
          `INSERT INTO moves (id, item_id, from_location_id, to_location_id, from_path, to_path, moved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uuid(), item.id, id, loc.parent_id, fromPath, toPath, t],
        );
      }
      await db.runAsync('UPDATE items SET location_id = ?, updated_at = ? WHERE location_id = ?', [
        loc.parent_id,
        t,
        id,
      ]);
      // Rename the doomed place out of the way first, so a child with the
      // same name ("Box › Box") can take its slot.
      await db.runAsync('UPDATE locations SET name = ? WHERE id = ?', [`\u0000deleted:${id}`, id]);
      // Re-parent children one by one; a name clash with a sibling of the
      // deleted place gets merged into that sibling.
      const children = await db.getAllAsync<LocationRow>('SELECT * FROM locations WHERE parent_id = ?', [id]);
      for (const child of children) {
        const clash = await db.getFirstAsync<{ id: string }>(
          `SELECT id FROM locations WHERE ifnull(parent_id, '') = ifnull(?, '') AND name = ? COLLATE NOCASE AND id != ?`,
          [loc.parent_id, child.name, child.id],
        );
        if (clash) {
          await mergeInto(child.id, clash.id);
        } else {
          await db.runAsync('UPDATE locations SET parent_id = ? WHERE id = ?', [loc.parent_id, child.id]);
        }
      }
      await db.runAsync('DELETE FROM locations WHERE id = ?', [id]);
    });
  }

  async function mergeInto(sourceId: string, targetId: string): Promise<void> {
    await db.runAsync('UPDATE items SET location_id = ? WHERE location_id = ?', [targetId, sourceId]);
    const children = await db.getAllAsync<LocationRow>('SELECT * FROM locations WHERE parent_id = ?', [sourceId]);
    for (const child of children) {
      const clash = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM locations WHERE parent_id = ? AND name = ? COLLATE NOCASE`,
        [targetId, child.name],
      );
      if (clash) await mergeInto(child.id, clash.id);
      else await db.runAsync('UPDATE locations SET parent_id = ? WHERE id = ?', [targetId, child.id]);
    }
    await db.runAsync('DELETE FROM locations WHERE id = ?', [sourceId]);
  }

  /**
   * Replaces an item's subjects. `aiTags` were suggested by the on-device
   * assistant and approved by the user; subjects kept from before keep their
   * origin.
   */
  async function setTags(itemId: string, tags: string[], aiTags: string[] = []): Promise<void> {
    const before = await db.getAllAsync<{ name: string; source: string }>(
      'SELECT t.name, it.source FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ?',
      [itemId],
    );
    const sourceOf = new Map(before.map((r) => [r.name.toLowerCase(), r.source]));
    for (const t of cleanTags(aiTags)) sourceOf.set(t.toLowerCase(), 'ai');
    await db.runAsync('DELETE FROM item_tags WHERE item_id = ?', [itemId]);
    for (const tag of cleanTags([...tags, ...aiTags])) {
      let row = await db.getFirstAsync<{ id: string }>('SELECT id FROM tags WHERE name = ? COLLATE NOCASE', [tag]);
      if (!row) {
        row = { id: uuid() };
        await db.runAsync('INSERT INTO tags (id, name) VALUES (?, ?)', [row.id, tag]);
      }
      await db.runAsync('INSERT OR IGNORE INTO item_tags (item_id, tag_id, source) VALUES (?, ?, ?)', [
        itemId,
        row.id,
        sourceOf.get(tag.toLowerCase()) === 'ai' ? 'ai' : 'user',
      ]);
    }
    await db.runAsync('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM item_tags)');
  }

  /** Stored embeddings that are still current (newer than the item's last change). */
  async function listEmbeddings(model: string): Promise<{ id: string; embedding: Uint8Array }[]> {
    return db.getAllAsync<{ id: string; embedding: Uint8Array }>(
      `SELECT id, embedding FROM items
       WHERE embedding IS NOT NULL AND embedding_model = ? AND embedding_updated_at >= updated_at`,
      [model],
    );
  }

  /** Items whose embedding is missing or older than their last change. */
  async function staleEmbeddings(model: string, limit = 50): Promise<string[]> {
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM items
       WHERE embedding IS NULL OR embedding_model IS NOT ? OR embedding_updated_at < updated_at
       ORDER BY updated_at DESC LIMIT ?`,
      [model, limit],
    );
    return rows.map((r) => r.id);
  }

  async function setEmbedding(itemId: string, embedding: Uint8Array, model: string): Promise<void> {
    // Stamped with the item's own updated_at so a later edit marks it stale.
    await db.runAsync(
      'UPDATE items SET embedding = ?, embedding_model = ?, embedding_updated_at = updated_at WHERE id = ?',
      [embedding, model, itemId],
    );
  }

  /**
   * Adds a thing in one transaction: the place path (created as needed), the
   * item and, if it starts out lent, its loan. Either all of it is saved or
   * none of it, so a failed save can be retried without leaving duplicates.
   */
  async function addItem(input: {
    name: string;
    /** An existing place, or */
    locationId?: string | null;
    /** a path to find or create, starting below `placeParentId` (or the root). */
    placeNames?: string[];
    placeParentId?: string | null;
    notes?: string | null;
    tags?: string[];
    /** Subjects suggested by the assistant and approved. */
    aiTags?: string[];
    lendTo?: { person: string; dueAt?: number | null };
    photos?: PhotoInput[];
  }): Promise<string> {
    const name = cleanName(input.name, 'Item');
    const notes = cleanNotes(input.notes);
    const person = input.lendTo ? cleanName(input.lendTo.person, 'Person') : null;
    const id = uuid();
    const t = now();
    await db.withTransactionAsync(async () => {
      const locationId = input.placeNames?.length
        ? await ensureLocationPath(input.placeNames, input.placeParentId ?? null)
        : (input.locationId ?? null);
      const toPath = await pathString(locationId);
      await db.runAsync(
        'INSERT INTO items (id, name, notes, location_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, name, notes, locationId, t, t],
      );
      if (locationId) {
        await db.runAsync(
          `INSERT INTO moves (id, item_id, from_location_id, to_location_id, from_path, to_path, moved_at)
           VALUES (?, ?, NULL, ?, NULL, ?, ?)`,
          [uuid(), id, locationId, toPath, t],
        );
      }
      if (input.tags?.length || input.aiTags?.length) await setTags(id, input.tags ?? [], input.aiTags);
      await touchLocation(locationId);
      if (person) await insertLoan(id, person, input.lendTo?.dueAt ?? null, null, t);
      for (const photo of input.photos ?? []) await insertPhoto({ itemId: id }, photo, t);
    });
    return id;
  }

  async function insertPhoto(owner: { itemId?: string; locationId?: string }, photo: PhotoInput, t: number): Promise<string> {
    const id = uuid();
    await db.runAsync(
      `INSERT INTO photos (id, item_id, location_id, uri, kind, created_at, data, thumb, width, height)
       VALUES (?, ?, ?, 'inline', ?, ?, ?, ?, ?, ?)`,
      [id, owner.itemId ?? null, owner.locationId ?? null, photo.kind ?? 'item', t, photo.data, photo.thumb, photo.width, photo.height],
    );
    return id;
  }

  async function addPhoto(owner: { itemId: string } | { locationId: string }, photo: PhotoInput): Promise<string> {
    const t = now();
    let id = '';
    await db.withTransactionAsync(async () => {
      id = await insertPhoto(owner, photo, t);
      if ('itemId' in owner) await db.runAsync('UPDATE items SET updated_at = ? WHERE id = ?', [t, owner.itemId]);
    });
    return id;
  }

  async function getPhoto(id: string): Promise<Photo | null> {
    const r = await db.getFirstAsync<{
      id: string;
      item_id: string | null;
      location_id: string | null;
      kind: Photo['kind'];
      data: string | null;
      width: number | null;
      height: number | null;
      created_at: number;
    }>('SELECT id, item_id, location_id, kind, data, width, height, created_at FROM photos WHERE id = ?', [id]);
    if (!r?.data) return null;
    return {
      id: r.id,
      itemId: r.item_id,
      locationId: r.location_id,
      kind: r.kind,
      data: r.data,
      width: r.width,
      height: r.height,
      createdAt: r.created_at,
    };
  }

  async function deletePhoto(id: string): Promise<void> {
    await db.runAsync('DELETE FROM photos WHERE id = ?', [id]);
  }

  async function updateItem(
    id: string,
    patch: { name?: string; notes?: string | null; tags?: string[]; aiTags?: string[] },
  ): Promise<void> {
    await db.withTransactionAsync(async () => {
      if (patch.name !== undefined) {
        await db.runAsync('UPDATE items SET name = ? WHERE id = ?', [cleanName(patch.name, 'Item'), id]);
      }
      if (patch.notes !== undefined) {
        await db.runAsync('UPDATE items SET notes = ? WHERE id = ?', [cleanNotes(patch.notes), id]);
      }
      if (patch.tags !== undefined || patch.aiTags !== undefined) await setTags(id, patch.tags ?? [], patch.aiTags);
      await db.runAsync('UPDATE items SET updated_at = ? WHERE id = ?', [now(), id]);
    });
  }

  /**
   * Records a move. Returns the move's id (for undo), or null when the item
   * was already there.
   */
  async function moveItem(id: string, toLocationId: string | null): Promise<string | null> {
    const item = await db.getFirstAsync<ItemRow>('SELECT * FROM items WHERE id = ?', [id]);
    if (!item) throw new Error('That item no longer exists');
    if (item.location_id === toLocationId) return null;
    const index = buildLocationIndex(await listLocations());
    const fromPath = item.location_id && index.byId.has(item.location_id) ? index.pathString(item.location_id) : null;
    const toPath = toLocationId && index.byId.has(toLocationId) ? index.pathString(toLocationId) : null;
    const t = now();
    const moveId = uuid();
    await db.withTransactionAsync(async () => {
      await db.runAsync('UPDATE items SET location_id = ?, updated_at = ? WHERE id = ?', [toLocationId, t, id]);
      await db.runAsync(
        `INSERT INTO moves (id, item_id, from_location_id, to_location_id, from_path, to_path, moved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [moveId, id, item.location_id, toLocationId, fromPath, toPath, t],
      );
      await touchLocation(toLocationId);
    });
    return moveId;
  }

  /**
   * Takes a move back: the item returns to where it was and the move leaves
   * the history, as if it never happened. Does nothing if the item has moved
   * again since.
   */
  async function undoMove(moveId: string): Promise<void> {
    const move = await db.getFirstAsync<{ item_id: string; from_location_id: string | null; to_location_id: string | null }>(
      'SELECT item_id, from_location_id, to_location_id FROM moves WHERE id = ?',
      [moveId],
    );
    if (!move) return;
    await db.withTransactionAsync(async () => {
      const from = move.from_location_id
        ? ((await db.getFirstAsync<{ id: string }>('SELECT id FROM locations WHERE id = ?', [move.from_location_id]))?.id ?? null)
        : null;
      const { changes } = await db.runAsync(
        'UPDATE items SET location_id = ?, updated_at = ? WHERE id = ? AND location_id IS ?',
        [from, now(), move.item_id, move.to_location_id],
      );
      if (changes) await db.runAsync('DELETE FROM moves WHERE id = ?', [moveId]);
    });
  }

  /**
   * Deletes an item and everything hanging off it. Returns a snapshot that
   * `restoreItem` can put back, for undo.
   */
  async function deleteItem(id: string): Promise<ItemSnapshot | null> {
    let snapshot: ItemSnapshot | null = null;
    await db.withTransactionAsync(async () => {
      const item = await db.getFirstAsync<Record<string, SqlValue>>('SELECT * FROM items WHERE id = ?', [id]);
      if (!item) return;
      const [tags, photos, loans, moves] = await Promise.all([
        db.getAllAsync<{ name: string; source: string }>(
          'SELECT t.name, it.source FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ?',
          [id],
        ),
        db.getAllAsync<Record<string, SqlValue>>('SELECT * FROM photos WHERE item_id = ?', [id]),
        db.getAllAsync<Record<string, SqlValue>>('SELECT * FROM loans WHERE item_id = ?', [id]),
        db.getAllAsync<Record<string, SqlValue>>('SELECT * FROM moves WHERE item_id = ?', [id]),
      ]);
      snapshot = { item, tags, photos, loans, moves };
      await db.runAsync('DELETE FROM items WHERE id = ?', [id]);
      await db.runAsync('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM item_tags)');
    });
    return snapshot;
  }

  async function insertRow(table: string, row: Record<string, SqlValue>): Promise<void> {
    const cols = Object.keys(row);
    await db.runAsync(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c]!));
  }

  /** Puts back an item removed by `deleteItem`. */
  async function restoreItem(snapshot: ItemSnapshot): Promise<void> {
    await db.withTransactionAsync(async () => {
      const item = { ...snapshot.item };
      // Its place may have been removed in the meantime.
      if (item.location_id && !(await db.getFirstAsync('SELECT id FROM locations WHERE id = ?', [item.location_id]))) {
        item.location_id = null;
      }
      await insertRow('items', item);
      for (const { name, source } of snapshot.tags) {
        let row = await db.getFirstAsync<{ id: string }>('SELECT id FROM tags WHERE name = ? COLLATE NOCASE', [name]);
        if (!row) {
          row = { id: uuid() };
          await db.runAsync('INSERT INTO tags (id, name) VALUES (?, ?)', [row.id, name]);
        }
        await db.runAsync('INSERT OR IGNORE INTO item_tags (item_id, tag_id, source) VALUES (?, ?, ?)', [item.id as string, row.id, source]);
      }
      for (const r of snapshot.photos) await insertRow('photos', r);
      for (const r of snapshot.loans) await insertRow('loans', r);
      for (const r of snapshot.moves) await insertRow('moves', r);
    });
  }

  async function insertLoan(itemId: string, person: string, dueAt: number | null, notes: string | null, t: number) {
    const id = uuid();
    await db.runAsync('INSERT INTO loans (id, item_id, person, lent_at, due_at, notes) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      itemId,
      person,
      t,
      dueAt,
      notes,
    ]);
    return id;
  }

  async function lendItem(
    itemId: string,
    input: { person: string; dueAt?: number | null; notes?: string | null },
  ): Promise<string> {
    const person = cleanName(input.person, 'Person');
    const notes = cleanNotes(input.notes);
    const active = await db.getFirstAsync<LoanRow>(
      'SELECT * FROM loans WHERE item_id = ? AND returned_at IS NULL',
      [itemId],
    );
    if (active) throw new Error(`Already lent to ${active.person}`);
    const t = now();
    let id = '';
    await db.withTransactionAsync(async () => {
      id = await insertLoan(itemId, person, input.dueAt ?? null, notes, t);
      await db.runAsync('UPDATE items SET updated_at = ? WHERE id = ?', [t, itemId]);
    });
    return id;
  }

  /** Marks the active loan returned. Returns its id (for undo), or null if it wasn't lent. */
  async function returnItem(itemId: string): Promise<string | null> {
    const t = now();
    const active = await db.getFirstAsync<{ id: string }>('SELECT id FROM loans WHERE item_id = ? AND returned_at IS NULL', [itemId]);
    if (!active) return null;
    await db.withTransactionAsync(async () => {
      await db.runAsync('UPDATE loans SET returned_at = ? WHERE id = ?', [t, active.id]);
      await db.runAsync('UPDATE items SET updated_at = ? WHERE id = ?', [t, itemId]);
    });
    return active.id;
  }

  /** Re-opens a loan marked returned by mistake, unless the item was lent again since. */
  async function undoReturn(loanId: string): Promise<void> {
    await db.runAsync(
      `UPDATE loans SET returned_at = NULL WHERE id = ? AND NOT EXISTS (
         SELECT 1 FROM loans other WHERE other.item_id = loans.item_id AND other.returned_at IS NULL)`,
      [loanId],
    );
  }

  async function setLoanDue(loanId: string, dueAt: number | null): Promise<void> {
    await db.runAsync('UPDATE loans SET due_at = ? WHERE id = ?', [dueAt, loanId]);
  }

  async function listItems(): Promise<Item[]> {
    const [items, tags, loans, photos] = await Promise.all([
      db.getAllAsync<ItemRow>('SELECT id, name, notes, location_id, created_at, updated_at FROM items'),
      db.getAllAsync<{ item_id: string; name: string }>(
        'SELECT it.item_id, t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id ORDER BY t.name',
      ),
      db.getAllAsync<LoanRow>('SELECT * FROM loans WHERE returned_at IS NULL'),
      db.getAllAsync<{ id: string; item_id: string; thumb: string | null }>(
        'SELECT id, item_id, thumb FROM photos WHERE item_id IS NOT NULL ORDER BY created_at, id',
      ),
    ]);
    const photosByItem = new Map<string, { ids: string[]; cover: string | null }>();
    for (const ph of photos) {
      const entry = photosByItem.get(ph.item_id) ?? { ids: [], cover: ph.thumb };
      entry.ids.push(ph.id);
      photosByItem.set(ph.item_id, entry);
    }
    const tagsByItem = new Map<string, string[]>();
    for (const t of tags) {
      const list = tagsByItem.get(t.item_id) ?? [];
      list.push(t.name);
      tagsByItem.set(t.item_id, list);
    }
    const loanByItem = new Map(loans.map((l) => [l.item_id, toLoan(l)]));
    return items.map((r) => ({
      id: r.id,
      name: r.name,
      notes: r.notes,
      locationId: r.location_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      tags: tagsByItem.get(r.id) ?? [],
      activeLoan: loanByItem.get(r.id) ?? null,
      photoIds: photosByItem.get(r.id)?.ids ?? [],
      cover: photosByItem.get(r.id)?.cover ?? null,
    }));
  }

  async function itemHistory(itemId: string): Promise<HistoryEvent[]> {
    const [moves, loans] = await Promise.all([
      db.getAllAsync<{ id: string; from_path: string | null; to_path: string | null; moved_at: number }>(
        'SELECT id, from_path, to_path, moved_at FROM moves WHERE item_id = ?',
        [itemId],
      ),
      db.getAllAsync<LoanRow>('SELECT * FROM loans WHERE item_id = ?', [itemId]),
    ]);
    const events: HistoryEvent[] = moves.map((m) => ({
      kind: 'moved',
      id: m.id,
      at: m.moved_at,
      fromPath: m.from_path,
      toPath: m.to_path,
    }));
    for (const l of loans) {
      events.push({ kind: 'lent', id: `${l.id}:lent`, at: l.lent_at, person: l.person, dueAt: l.due_at });
      if (l.returned_at !== null) {
        events.push({ kind: 'returned', id: `${l.id}:returned`, at: l.returned_at, person: l.person });
      }
    }
    return events.sort((a, b) => b.at - a.at);
  }

  /** People you have lent to, most recent first. */
  async function knownPeople(limit = 20): Promise<string[]> {
    const rows = await db.getAllAsync<{ person: string }>(
      `SELECT person FROM loans GROUP BY person COLLATE NOCASE ORDER BY max(lent_at) DESC LIMIT ?`,
      [limit],
    );
    return rows.map((r) => r.person);
  }

  async function getSetting(key: string): Promise<string | null> {
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return row?.value ?? null;
  }

  async function setSetting(key: string, value: string): Promise<void> {
    await db.runAsync(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  /** Places with a fingerprint or photos of their own. */
  async function listBoxes(): Promise<BoxInfo[]> {
    const [fps, photos] = await Promise.all([
      db.getAllAsync<{ id: string; fingerprint: Uint8Array | null }>(
        'SELECT id, fingerprint FROM locations WHERE fingerprint IS NOT NULL',
      ),
      db.getAllAsync<{ id: string; location_id: string; thumb: string | null }>(
        'SELECT id, location_id, thumb FROM photos WHERE location_id IS NOT NULL ORDER BY created_at, id',
      ),
    ]);
    const boxes = new Map<string, BoxInfo>();
    const get = (id: string) => {
      let b = boxes.get(id);
      if (!b) boxes.set(id, (b = { locationId: id, fingerprint: null, photoIds: [], cover: null }));
      return b;
    };
    for (const r of fps) get(r.id).fingerprint = r.fingerprint instanceof Uint8Array ? r.fingerprint : new Uint8Array(r.fingerprint ?? []);
    for (const ph of photos) {
      const b = get(ph.location_id);
      if (!b.cover) b.cover = ph.thumb;
      b.photoIds.push(ph.id);
    }
    return [...boxes.values()];
  }

  async function setFingerprint(locationId: string, fingerprint: Uint8Array | null, model: string | null): Promise<void> {
    await db.runAsync('UPDATE locations SET fingerprint = ?, fingerprint_model = ? WHERE id = ?', [fingerprint, model, locationId]);
  }

  /** Forgets how to recognise a place: its fingerprint and its own photos. */
  async function clearBox(locationId: string): Promise<void> {
    await db.withTransactionAsync(async () => {
      await db.runAsync('UPDATE locations SET fingerprint = NULL, fingerprint_model = NULL WHERE id = ?', [locationId]);
      await db.runAsync('DELETE FROM photos WHERE location_id = ?', [locationId]);
    });
  }

  async function allSettings(): Promise<Record<string, string>> {
    const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  return {
    allSettings,
    listBoxes,
    setFingerprint,
    listEmbeddings,
    staleEmbeddings,
    setEmbedding,
    clearBox,
    listLocations,
    ensureLocationPath,
    renameLocation,
    setLocationParent,
    deleteLocation,
    addItem,
    updateItem,
    moveItem,
    undoMove,
    deleteItem,
    restoreItem,
    addPhoto,
    getPhoto,
    deletePhoto,
    lendItem,
    returnItem,
    undoReturn,
    setLoanDue,
    listItems,
    itemHistory,
    knownPeople,
    getSetting,
    setSetting,
  };
}

export { PATH_SEPARATOR };
