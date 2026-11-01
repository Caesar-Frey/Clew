import * as SQLite from 'expo-sqlite';

import { forgetKeys, newKey, readKey, storeNewKey } from '../security/keyVault';

import { migrate } from './schema';
import type { Db } from './types';

// Old app name kept on purpose: renaming the file would hide the existing catalog.
const DB_NAME = 'whereabouts.db';

/** The database exists but can't be decrypted with the stored key. */
export class DatabaseUnreadableError extends Error {
  constructor(cause: unknown) {
    super('Your saved data could not be unlocked on this device.');
    this.name = 'DatabaseUnreadableError';
    this.cause = cause;
  }
}

function adapt(db: SQLite.SQLiteDatabase): Db {
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: (sql, params = []) => db.runAsync(sql, params),
    getAllAsync: (sql, params = []) => db.getAllAsync(sql, params),
    getFirstAsync: (sql, params = []) => db.getFirstAsync(sql, params),
    withTransactionAsync: (task) => db.withTransactionAsync(task),
    closeAsync: () => db.closeAsync(),
  };
}

/**
 * Opens the SQLCipher-encrypted database, creating it and its 256-bit key on
 * first launch. The raw key lives only in the iOS Keychain / Android Keystore
 * (never synced or backed up), optionally sealed behind biometrics.
 */
export async function openEncryptedDatabase(): Promise<Db> {
  let key = await readKey();
  const isNewKey = key === null;
  if (!key) key = await newKey();
  if (!/^[0-9a-f]{64}$/.test(key)) throw new DatabaseUnreadableError(new Error('Malformed key'));

  const raw = await SQLite.openDatabaseAsync(DB_NAME);
  // Must be the first statement on the connection. A raw hex key skips
  // SQLCipher's passphrase derivation since it's already random.
  await raw.execAsync(`PRAGMA key = "x'${key}'";`);

  // A build without SQLCipher is a packaging bug, not a lost key: it must not
  // be reported as "unreadable", which would offer to erase the user's data.
  const cipher = await raw.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
  if (!cipher?.cipher_version) {
    if (!__DEV__) {
      await raw.closeAsync().catch(() => {});
      throw new Error('This build of Clew cannot encrypt data. Please update the app.');
    }
    console.warn('[clew] SQLCipher missing: data is NOT encrypted (dev build only).');
  }

  try {
    // Fails with "file is not a database" if the key doesn't match.
    await raw.getFirstAsync('SELECT count(*) FROM sqlite_master');
  } catch (e) {
    await raw.closeAsync().catch(() => {});
    throw new DatabaseUnreadableError(e);
  }

  // Only remember a fresh key once it has unlocked (i.e. created) the file.
  if (isNewKey) await storeNewKey(key);

  await raw.execAsync('PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON;');
  const db = adapt(raw);
  await migrate(db);
  return db;
}

/** Permanently erases all data and the key. Used to recover from a lost key. */
export async function eraseAllData(): Promise<void> {
  // If the file can't be removed, keep the key: a fresh key would only meet
  // the same unreadable file again.
  await SQLite.deleteDatabaseAsync(DB_NAME);
  await forgetKeys();
}
