import { scryptAsync } from '@noble/hashes/scrypt.js';

import { MIGRATIONS } from '../db/schema';
import type { Db, SqlValue } from '../db/types';

/**
 * Encrypted backups ("archives").
 *
 * The database key never leaves the phone, so a lost or wiped phone would
 * lose the catalog. An archive is a full copy of the catalog sealed with a
 * passphrase only the user knows, so it can be kept anywhere (Files, Drive,
 * a computer) and opened on a new phone.
 *
 * File layout:
 *   "CLEW" | u8 format version | u32 BE header length | header JSON | sealed body
 * The header holds the KDF parameters, salt and nonce. The body is AES-256-GCM
 * over the catalog JSON, with every byte before it as associated data, so a
 * tampered header fails to open just like a wrong passphrase.
 *
 * The app was called Whereabouts before it was Clew. Archives from then start
 * with "WHBK" and name the old app in the header and catalog; they still open.
 */

const MAGIC = [0x43, 0x4c, 0x45, 0x57]; // "CLEW"
const LEGACY_MAGIC = [0x57, 0x48, 0x42, 0x4b]; // "WHBK", from the Whereabouts days
const FORMAT_VERSION = 1;
export const ARCHIVE_EXTENSION = 'clew';

const DUMP_FORMATS = ['clew-catalog', 'whereabouts-catalog'];
const HEADER_APPS = ['clew', 'whereabouts'];

/** Tables in insert order (parents before children). */
export const BACKUP_TABLES = ['locations', 'items', 'tags', 'item_tags', 'photos', 'loans', 'moves', 'settings'] as const;

/** Settings that describe this phone, not the catalog, and must not travel. */
const DEVICE_SETTINGS = /^device\./;

export const MIN_PASSPHRASE_LENGTH = 8;

export interface KdfParams {
  N: number;
  r: number;
  p: number;
}
/** scrypt at 32 MiB: a few seconds on a phone, expensive to brute-force. */
export const DEFAULT_KDF: KdfParams = { N: 2 ** 15, r: 8, p: 1 };

/** AES-256-GCM, provided natively on the phone and by a JS library in tests. */
export interface Aead {
  seal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  /** Must reject if the tag doesn't verify. */
  open(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
}

export interface ArchiveDeps {
  aead: Aead;
  randomBytes: (n: number) => Uint8Array | Promise<Uint8Array>;
  /** 0..1 while the passphrase is being stretched. */
  onProgress?: (fraction: number) => void;
  kdf?: KdfParams;
}

type Row = Record<string, string | number | null | { $hex: string }>;

export interface CatalogDump {
  format: 'clew-catalog' | 'whereabouts-catalog';
  schemaVersion: number;
  exportedAt: number;
  tables: Record<string, Row[]>;
}

export class NotAnArchiveError extends Error {
  constructor() {
    super("That file isn't a Clew backup.");
    this.name = 'NotAnArchiveError';
  }
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("That passphrase doesn't open this backup.");
    this.name = 'WrongPassphraseError';
  }
}

export class NewerArchiveError extends Error {
  constructor() {
    super('This backup was made by a newer version of Clew. Update the app, then try again.');
    this.name = 'NewerArchiveError';
  }
}

/* ------------------------------------------------------------- encoding */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new NotAnArchiveError();
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/* ----------------------------------------------------------------- dump */

/** Reads the whole catalog into plain JSON-safe rows. */
export async function dumpCatalog(db: Db, now: number): Promise<CatalogDump> {
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const tables: Record<string, Row[]> = {};
  for (const table of BACKUP_TABLES) {
    const rows = await db.getAllAsync<Record<string, SqlValue>>(`SELECT * FROM ${table}`);
    tables[table] = rows
      .filter((r) => table !== 'settings' || !DEVICE_SETTINGS.test(String(r.key)))
      .map((r) => {
        const out: Row = {};
        for (const [k, v] of Object.entries(r)) out[k] = v instanceof Uint8Array ? { $hex: toHex(v) } : v;
        return out;
      });
  }
  return { format: 'clew-catalog', schemaVersion: version?.user_version ?? 0, exportedAt: now, tables };
}

/**
 * Replaces the catalog with the archived one, in a single transaction: if any
 * row fails, nothing changes. Device settings on this phone are kept.
 */
export async function restoreCatalog(db: Db, dump: CatalogDump): Promise<void> {
  validateDump(dump);
  if (dump.schemaVersion > MIGRATIONS.length) throw new NewerArchiveError();
  // Only columns this version of the app knows; column names never come
  // from the file.
  const columns = new Map<string, Set<string>>();
  for (const table of BACKUP_TABLES) {
    const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    columns.set(table, new Set(info.map((c) => c.name)));
  }
  await db.withTransactionAsync(async () => {
    // Locations point at their parents, so check foreign keys at commit.
    await db.execAsync('PRAGMA defer_foreign_keys = ON;');
    for (const table of [...BACKUP_TABLES].reverse()) {
      if (table === 'settings') await db.runAsync("DELETE FROM settings WHERE key NOT LIKE 'device.%'");
      else await db.runAsync(`DELETE FROM ${table}`);
    }
    for (const table of BACKUP_TABLES) {
      const known = columns.get(table)!;
      for (const row of dump.tables[table] ?? []) {
        if (table === 'settings' && DEVICE_SETTINGS.test(String(row.key))) continue;
        const cols = Object.keys(row).filter((c) => known.has(c));
        if (cols.length === 0) continue;
        const values = cols.map((c) => decodeValue(row[c]));
        await db.runAsync(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          values,
        );
      }
    }
  });
}

function decodeValue(v: Row[string] | undefined): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  return fromHex(v.$hex);
}

function validateDump(dump: unknown): asserts dump is CatalogDump {
  const d = dump as CatalogDump;
  const ok =
    !!d &&
    DUMP_FORMATS.includes(d.format) &&
    Number.isInteger(d.schemaVersion) &&
    typeof d.tables === 'object' &&
    d.tables !== null &&
    Object.values(d.tables).every(
      (rows) =>
        Array.isArray(rows) &&
        rows.every(
          (r) =>
            typeof r === 'object' &&
            r !== null &&
            Object.values(r).every(
              (v) =>
                v === null ||
                typeof v === 'string' ||
                typeof v === 'number' ||
                (typeof v === 'object' && typeof (v as { $hex?: unknown }).$hex === 'string'),
            ),
        ),
    );
  if (!ok) throw new NotAnArchiveError();
}

/* ------------------------------------------------------------- sealing */

interface Header {
  app: 'clew' | 'whereabouts';
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  nonce: string;
  createdAt: number;
  /** Counts shown before restoring, so the user knows what they're about to get. */
  summary: ArchiveSummary;
}

export interface ArchiveSummary {
  items: number;
  places: number;
  photos: number;
}

export function summarize(dump: CatalogDump): ArchiveSummary {
  return {
    items: dump.tables.items?.length ?? 0,
    places: dump.tables.locations?.length ?? 0,
    photos: dump.tables.photos?.length ?? 0,
  };
}

async function deriveKey(passphrase: string, salt: Uint8Array, kdf: KdfParams, onProgress?: (f: number) => void) {
  return scryptAsync(passphrase.normalize('NFKC'), salt, { ...kdf, dkLen: 32, onProgress, asyncTick: 25 });
}

export function checkPassphrase(passphrase: string): string | null {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) return `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  return null;
}

export async function sealArchive(dump: CatalogDump, passphrase: string, deps: ArchiveDeps): Promise<Uint8Array> {
  const problem = checkPassphrase(passphrase);
  if (problem) throw new Error(problem);
  const kdf = deps.kdf ?? DEFAULT_KDF;
  const salt = await deps.randomBytes(16);
  const nonce = await deps.randomBytes(12);
  const header: Header = {
    app: 'clew',
    kdf: 'scrypt',
    ...kdf,
    salt: toHex(salt),
    nonce: toHex(nonce),
    createdAt: dump.exportedAt,
    summary: summarize(dump),
  };
  const headerBytes = encoder.encode(JSON.stringify(header));
  const prefix = new Uint8Array(9 + headerBytes.length);
  prefix.set(MAGIC, 0);
  prefix[4] = FORMAT_VERSION;
  new DataView(prefix.buffer).setUint32(5, headerBytes.length);
  prefix.set(headerBytes, 9);

  const key = await deriveKey(passphrase, salt, kdf, deps.onProgress);
  try {
    const body = await deps.aead.seal(key, nonce, encoder.encode(JSON.stringify(dump)), prefix);
    const out = new Uint8Array(prefix.length + body.length);
    out.set(prefix, 0);
    out.set(body, prefix.length);
    return out;
  } finally {
    key.fill(0);
  }
}

function parsePrefix(file: Uint8Array): { header: Header; prefix: Uint8Array; body: Uint8Array } {
  const magicIs = (m: number[]) => m.every((b, i) => file[i] === b);
  if (file.length < 9 || !(magicIs(MAGIC) || magicIs(LEGACY_MAGIC))) throw new NotAnArchiveError();
  if (file[4]! > FORMAT_VERSION) throw new NewerArchiveError();
  const len = new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(5);
  if (len > 64 * 1024 || 9 + len >= file.length) throw new NotAnArchiveError();
  let header: Header;
  try {
    header = JSON.parse(decoder.decode(file.subarray(9, 9 + len)));
  } catch {
    throw new NotAnArchiveError();
  }
  const sane =
    HEADER_APPS.includes(header?.app) &&
    header.kdf === 'scrypt' &&
    // Refuse absurd costs a crafted file could use to hang the phone.
    Number.isInteger(header.N) && header.N >= 2 ** 10 && header.N <= 2 ** 20 &&
    Number.isInteger(header.r) && header.r >= 1 && header.r <= 16 &&
    Number.isInteger(header.p) && header.p >= 1 && header.p <= 4 &&
    typeof header.salt === 'string' &&
    typeof header.nonce === 'string';
  if (!sane) throw new NotAnArchiveError();
  return { header, prefix: file.subarray(0, 9 + len), body: file.subarray(9 + len) };
}

/** Reads what an archive holds without the passphrase (the header isn't secret). */
export function peekArchive(file: Uint8Array): { createdAt: number; summary: ArchiveSummary | null } {
  const { header } = parsePrefix(file);
  return { createdAt: header.createdAt, summary: header.summary ?? null };
}

export async function openArchive(file: Uint8Array, passphrase: string, deps: ArchiveDeps): Promise<CatalogDump> {
  const { header, prefix, body } = parsePrefix(file);
  const key = await deriveKey(passphrase, fromHex(header.salt), header, deps.onProgress);
  let plain: Uint8Array;
  try {
    plain = await deps.aead.open(key, fromHex(header.nonce), body, prefix);
  } catch {
    throw new WrongPassphraseError();
  } finally {
    key.fill(0);
  }
  let dump: unknown;
  try {
    dump = JSON.parse(decoder.decode(plain));
  } catch {
    throw new NotAnArchiveError();
  }
  validateDump(dump);
  if (dump.schemaVersion > MIGRATIONS.length) throw new NewerArchiveError();
  return dump;
}
