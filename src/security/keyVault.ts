import { scryptAsync } from '@noble/hashes/scrypt.js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { DEFAULT_KDF, fromHex, toHex, type KdfParams } from '../backup/archive';
import { nativeAead } from '../backup/device';

/**
 * Where the database key lives.
 *
 * "device" (default): in the Keychain/Keystore, readable whenever the phone
 * is unlocked. The app lock is a screen in front of the data.
 *
 * "sealed": the OS releases the key only after Face ID / fingerprint, so the
 * catalog can't be decrypted without the owner, even by something that can
 * read the app's keychain. The OS throws a sealed key away when the enrolled
 * faces or fingerprints change, so a copy is also kept wrapped with a
 * recovery passphrase only the user knows.
 */
export type KeyMode = 'device' | 'sealed';

// Stored under the app's old name (Whereabouts). Renaming would orphan existing keys and data.
const PLAIN_KEY = 'whereabouts.dbkey.v1';
const SEALED_KEY = 'whereabouts.dbkey.sealed.v1';
const RECOVERY = 'whereabouts.dbkey.recovery.v1';
const MODE = 'whereabouts.keymode.v1';

const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const SEALED_OPTS: SecureStore.SecureStoreOptions = {
  ...OPTS,
  requireAuthentication: true,
  authenticationPrompt: 'Unlock your catalog',
};

const KEY_PATTERN = /^[0-9a-f]{64}$/;

/** The sealed key couldn't be released: the user cancelled, or it was invalidated. */
export class KeyLockedError extends Error {
  /** True when the OS no longer has the key (biometrics changed). */
  readonly invalidated: boolean;
  constructor(invalidated: boolean, cause?: unknown) {
    super(invalidated ? 'Face ID or fingerprints changed on this phone.' : 'Unlock to open your catalog.');
    this.name = 'KeyLockedError';
    this.invalidated = invalidated;
    this.cause = cause;
  }
}

export async function getKeyMode(): Promise<KeyMode> {
  return (await SecureStore.getItemAsync(MODE, OPTS)) === 'sealed' ? 'sealed' : 'device';
}

/** Returns the database key, or null on first launch. May show the OS biometric prompt. */
export async function readKey(): Promise<string | null> {
  if ((await getKeyMode()) === 'device') return SecureStore.getItemAsync(PLAIN_KEY, OPTS);
  let key: string | null;
  try {
    key = await SecureStore.getItemAsync(SEALED_KEY, SEALED_OPTS);
  } catch (e) {
    throw new KeyLockedError(false, e);
  }
  // Null means the OS discarded the key (biometric enrolment changed).
  if (!key) throw new KeyLockedError(true);
  return key;
}

export async function newKey(): Promise<string> {
  return toHex(await Crypto.getRandomBytesAsync(32));
}

/** Remembers a freshly created key (always in device mode). */
export async function storeNewKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(PLAIN_KEY, key, OPTS);
}

export async function forgetKeys(): Promise<void> {
  for (const name of [PLAIN_KEY, SEALED_KEY, RECOVERY, MODE]) {
    await SecureStore.deleteItemAsync(name, name === SEALED_KEY ? SEALED_OPTS : OPTS).catch(() => {});
  }
}

/* -------------------------------------------------------------- recovery */

interface RecoveryBlob extends KdfParams {
  salt: string;
  nonce: string;
  sealed: string;
}

const AAD = new TextEncoder().encode('whereabouts-recovery-v1');

async function wrapKey(key: string, passphrase: string): Promise<RecoveryBlob> {
  const salt = await Crypto.getRandomBytesAsync(16);
  const nonce = await Crypto.getRandomBytesAsync(12);
  const kek = await scryptAsync(passphrase.normalize('NFKC'), salt, { ...DEFAULT_KDF, dkLen: 32 });
  try {
    const sealed = await nativeAead.seal(kek, nonce, fromHex(key), AAD);
    return { ...DEFAULT_KDF, salt: toHex(salt), nonce: toHex(nonce), sealed: toHex(sealed) };
  } finally {
    kek.fill(0);
  }
}

async function unwrapKey(blob: RecoveryBlob, passphrase: string): Promise<string> {
  const kek = await scryptAsync(passphrase.normalize('NFKC'), fromHex(blob.salt), { N: blob.N, r: blob.r, p: blob.p, dkLen: 32 });
  try {
    return toHex(await nativeAead.open(kek, fromHex(blob.nonce), fromHex(blob.sealed), AAD));
  } catch {
    throw new Error("That recovery passphrase isn't right.");
  } finally {
    kek.fill(0);
  }
}

export async function hasRecovery(): Promise<boolean> {
  return (await SecureStore.getItemAsync(RECOVERY, OPTS)) !== null;
}

/* ----------------------------------------------------------- transitions */

/**
 * Moves the key behind biometrics. The plain copy is removed only after the
 * sealed copy has been read back successfully.
 */
export async function sealKey(recoveryPassphrase: string): Promise<void> {
  if ((await getKeyMode()) === 'sealed') return;
  const key = await SecureStore.getItemAsync(PLAIN_KEY, OPTS);
  if (!key || !KEY_PATTERN.test(key)) throw new Error('No catalog key to seal yet.');
  await SecureStore.setItemAsync(RECOVERY, JSON.stringify(await wrapKey(key, recoveryPassphrase)), OPTS);
  await SecureStore.setItemAsync(SEALED_KEY, key, SEALED_OPTS);
  let check: string | null;
  try {
    check = await SecureStore.getItemAsync(SEALED_KEY, { ...SEALED_OPTS, authenticationPrompt: 'Seal your catalog' });
  } catch (e) {
    await SecureStore.deleteItemAsync(SEALED_KEY, SEALED_OPTS).catch(() => {});
    throw e;
  }
  if (check !== key) {
    await SecureStore.deleteItemAsync(SEALED_KEY, SEALED_OPTS).catch(() => {});
    throw new Error("The phone couldn't seal the key. Nothing was changed.");
  }
  await SecureStore.setItemAsync(MODE, 'sealed', OPTS);
  await SecureStore.deleteItemAsync(PLAIN_KEY, OPTS);
}

/** Back to device mode. Asks for biometrics to release the key. */
export async function unsealKey(): Promise<void> {
  if ((await getKeyMode()) === 'device') return;
  const key = await readKey();
  if (!key) throw new KeyLockedError(true);
  await moveToDevice(key);
}

async function moveToDevice(key: string): Promise<void> {
  await SecureStore.setItemAsync(PLAIN_KEY, key, OPTS);
  await SecureStore.setItemAsync(MODE, 'device', OPTS);
  await SecureStore.deleteItemAsync(SEALED_KEY, SEALED_OPTS).catch(() => {});
  await SecureStore.deleteItemAsync(RECOVERY, OPTS).catch(() => {});
}

/**
 * Opens the vault with the recovery passphrase when biometrics can't. The key
 * goes back to device mode; the user can seal it again from the Desk.
 */
export async function recoverKey(passphrase: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(RECOVERY, OPTS);
  if (!raw) throw new Error('No recovery passphrase was set on this phone.');
  const key = await unwrapKey(JSON.parse(raw) as RecoveryBlob, passphrase);
  if (!KEY_PATTERN.test(key)) throw new Error("That recovery passphrase isn't right.");
  await moveToDevice(key);
}
