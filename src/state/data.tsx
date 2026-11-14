import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { decodeFingerprint, type Fingerprint } from '../boxes/fingerprint';
import { dumpCatalog, openArchive, restoreCatalog, sealArchive, type CatalogDump } from '../backup/archive';
import { nativeAead, randomBytes, shareArchive } from '../backup/device';
import { openEncryptedDatabase } from '../db/open';
import { createRepo, type Repo } from '../db/repo';
import type { BoxInfo, Db, Item, Location, PhotoInput } from '../db/types';
import { buildLocationIndex, parsePathInput, type LocationIndex } from '../lib/locations';
import { findPath, type PlaceValue } from '../lib/placeQuery';

/** Creating a place that's already there. */
export class PlaceExistsError extends Error {
  constructor(
    readonly id: string,
    name: string,
  ) {
    super(`${name} already exists.`);
    this.name = 'PlaceExistsError';
  }
}

export interface Snapshot {
  items: Item[];
  locations: Location[];
  index: LocationIndex;
  people: string[];
  settings: Record<string, string>;
  /** Places with photos or a fingerprint, by location id. */
  boxes: Map<string, Box>;
}

export interface Box extends BoxInfo {
  fp: Fingerprint | null;
}

type Status = { state: 'loading' } | { state: 'error'; error: Error } | { state: 'ready' };

interface DataContextValue {
  status: Status;
  snapshot: Snapshot;
  actions: Actions;
  retry: () => void;
}

const EMPTY: Snapshot = { items: [], locations: [], index: buildLocationIndex([]), people: [], settings: {}, boxes: new Map() };

/** When this phone last made a backup. A device setting, so a restore doesn't overwrite it. */
export const LAST_BACKUP_KEY = 'device.lastBackupAt';

const DataContext = createContext<DataContextValue | null>(null);

function makeActions(db: Db, repo: Repo, refresh: () => Promise<void>) {
  const run =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const result = await fn(...args);
      await refresh();
      return result;
    };

  /** The id of a chosen place, creating it first if the user chose "Create new place". */
  const resolvePlace = async (place: PlaceValue): Promise<string | null> => {
    if (place.kind === 'existing') return place.id;
    if (place.kind === 'new') return repo.ensureLocationPath(place.names, place.parentId);
    return null;
  };

  return {
    addItem: run(
      (input: {
        name: string;
        place: PlaceValue;
        notes?: string;
        tags?: string[];
        lendTo?: { person: string; dueAt: number | null };
        photos?: PhotoInput[];
        aiTags?: string[];
      }) => {
        const { place, ...rest } = input;
        return repo.addItem({
          ...rest,
          locationId: place.kind === 'existing' ? place.id : null,
          placeNames: place.kind === 'new' ? place.names : undefined,
          placeParentId: place.kind === 'new' ? place.parentId : null,
        });
      },
    ),
    updateItem: run(repo.updateItem),
    moveItem: run(async (id: string, place: PlaceValue | { locationId: string | null }) => {
      const locationId = 'kind' in place ? await resolvePlace(place) : place.locationId;
      return repo.moveItem(id, locationId);
    }),
    undoMove: run(repo.undoMove),
    deleteItem: run(repo.deleteItem),
    restoreItem: run(repo.restoreItem),
    addPhoto: run(repo.addPhoto),
    deletePhoto: run(repo.deletePhoto),
    getPhoto: repo.getPhoto,
    lendItem: run(repo.lendItem),
    returnItem: run(repo.returnItem),
    undoReturn: run(repo.undoReturn),
    setLoanDue: run(repo.setLoanDue),
    /**
     * Creates a place from a typed path below `parentId`. If the whole path
     * already exists, throws PlaceExistsError carrying its id so the screen
     * can say so and open it.
     */
    addPlace: run(async (path: string, parentId: string | null = null) => {
      const names = parsePathInput(path);
      if (names.length === 0) throw new Error('Type a place name.');
      const index = buildLocationIndex(await repo.listLocations());
      const existing = findPath(names.join(' > '), index, parentId);
      if (existing) throw new PlaceExistsError(existing, index.byId.get(existing)!.name);
      return repo.ensureLocationPath(names, parentId);
    }),
    renamePlace: run(repo.renameLocation),
    setPlaceParent: run(repo.setLocationParent),
    deletePlace: run(repo.deleteLocation),
    itemHistory: repo.itemHistory,
    getSetting: repo.getSetting,
    setSetting: run(repo.setSetting),

    /** Seals the whole catalog with `passphrase` and opens the share sheet. */
    exportArchive: async (passphrase: string, onProgress?: (f: number) => void) => {
      const now = Date.now();
      const bytes = await sealArchive(await dumpCatalog(db, now), passphrase, { aead: nativeAead, randomBytes, onProgress });
      await shareArchive(bytes, now);
      await repo.setSetting(LAST_BACKUP_KEY, String(now));
      await refresh();
    },
    openArchive: (bytes: Uint8Array, passphrase: string, onProgress?: (f: number) => void) =>
      openArchive(bytes, passphrase, { aead: nativeAead, randomBytes, onProgress }),
    /** Replaces everything with the archived catalog. */
    restoreArchive: run((dump: CatalogDump) => restoreCatalog(db, dump)),

    /** Adds a photo of a box (and what was read from it) to its fingerprint. */
    addBoxView: run(repo.addBoxView),
    /** The id for a chosen place, creating it if the user chose "Create new place". */
    ensurePlace: run(resolvePlace),
    clearBox: run(repo.clearBox),

    // Embeddings change nothing visible, so they don't refresh the snapshot.
    listEmbeddings: repo.listEmbeddings,
    staleEmbeddings: repo.staleEmbeddings,
    setEmbedding: repo.setEmbedding,
  };
}

export type Actions = ReturnType<typeof makeActions>;

async function loadSnapshot(repo: Repo): Promise<Snapshot> {
  const [items, locations, people, settings, boxList] = await Promise.all([
    repo.listItems(),
    repo.listLocations(),
    repo.knownPeople(),
    repo.allSettings(),
    repo.listBoxes(),
  ]);
  const boxes = new Map(boxList.map((b) => [b.locationId, { ...b, fp: decodeFingerprint(b.fingerprint) }]));
  return { items, locations, index: buildLocationIndex(locations), people, settings, boxes };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  const [store, setStore] = useState<{ db: Db; repo: Repo } | null>(null);
  const repo = store?.repo ?? null;
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let db: Db | null = null;
    (async () => {
      const handle = await openEncryptedDatabase();
      if (cancelled) {
        await handle.closeAsync().catch(() => {});
        return;
      }
      db = handle;
      const opened = createRepo(db, { now: Date.now, uuid: Crypto.randomUUID });
      const first = await loadSnapshot(opened);
      if (cancelled) return;
      setStore({ db: handle, repo: opened });
      setSnapshot(first);
      setStatus({ state: 'ready' });
    })().catch((e: unknown) => {
      if (!cancelled) setStatus({ state: 'error', error: e instanceof Error ? e : new Error(String(e)) });
    });
    // The provider unmounts whenever the app lock closes; don't leave the
    // decrypted connection open behind the lock screen.
    return () => {
      cancelled = true;
      db?.closeAsync().catch(() => {});
    };
  }, [attempt]);

  const refresh = useCallback(async () => {
    if (repo) setSnapshot(await loadSnapshot(repo));
  }, [repo]);

  const actions = useMemo(() => (store ? makeActions(store.db, store.repo, refresh) : null), [store, refresh]);
  const retry = useCallback(() => {
    setStatus({ state: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo<DataContextValue>(
    () => ({ status, snapshot, actions: actions as Actions, retry }),
    [status, snapshot, actions, retry],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useDataStatus() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useDataStatus outside DataProvider');
  return { status: ctx.status, retry: ctx.retry };
}

/** Only valid once the store is ready (screens render behind that gate). */
export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData outside DataProvider');
  return { ...ctx.snapshot, actions: ctx.actions };
}

export function useItem(id: string | undefined) {
  const { items } = useData();
  return useMemo(() => items.find((i) => i.id === id) ?? null, [items, id]);
}

/** Places ordered by when they were last used, deepest (most specific) first. */
export function useRecentPlaces(limit = 8) {
  const { locations, index } = useData();
  return useMemo(() => {
    // Specific places (with nothing nested inside) are what you usually
    // pick, so they come first; broader ones fill the remaining slots.
    const byRecent = (a: Location, b: Location) => b.lastUsedAt - a.lastUsedAt;
    const leaves = locations.filter((l) => !index.children.get(l.id)?.length).sort(byRecent);
    const rest = locations.filter((l) => index.children.get(l.id)?.length).sort(byRecent);
    return [...leaves, ...rest].slice(0, limit);
  }, [locations, index, limit]);
}
