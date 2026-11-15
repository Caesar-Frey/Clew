/** In-memory SecureStore: `sealed` items need "biometrics", which tests can make fail. */
const mockStore = {
  items: new Map<string, string>(),
  biometrics: 'ok' as 'ok' | 'cancel' | 'invalidated',
  failDeletes: 0,
};

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
  async getItemAsync(key: string, opts?: { requireAuthentication?: boolean }) {
    if (opts?.requireAuthentication) {
      if (mockStore.biometrics === 'cancel') throw new Error('User cancelled');
      if (mockStore.biometrics === 'invalidated') return null;
    }
    return mockStore.items.get(key) ?? null;
  },
  async setItemAsync(key: string, value: string) {
    mockStore.items.set(key, value);
  },
  async deleteItemAsync(key: string) {
    if (key === 'whereabouts.dbkey.v1' && mockStore.failDeletes > 0) {
      mockStore.failDeletes--;
      throw new Error('keychain busy');
    }
    mockStore.items.delete(key);
  },
}));

jest.mock('expo-crypto', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes } = require('crypto');
  return { getRandomBytesAsync: async (n: number) => new Uint8Array(randomBytes(n)) };
});

jest.mock('../src/backup/device', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { gcm } = require('@noble/ciphers/aes.js');
  return {
    nativeAead: {
      seal: async (k: Uint8Array, n: Uint8Array, d: Uint8Array, a: Uint8Array) => gcm(k, n, a).encrypt(d),
      open: async (k: Uint8Array, n: Uint8Array, d: Uint8Array, a: Uint8Array) => gcm(k, n, a).decrypt(d),
    },
  };
});

import {
  forgetKeys,
  getKeyMode,
  hasRecovery,
  KeyLockedError,
  newKey,
  readKey,
  recoverKey,
  SealIncompleteError,
  sealKey,
  storeNewKey,
  unsealKey,
} from '../src/security/keyVault';

const PLAIN = 'whereabouts.dbkey.v1';

beforeEach(() => {
  mockStore.items.clear();
  mockStore.biometrics = 'ok';
  mockStore.failDeletes = 0;
});

async function freshKey() {
  const key = await newKey();
  await storeNewKey(key);
  return key;
}

describe('key vault', () => {
  it('starts in device mode and reads the plain key', async () => {
    const key = await freshKey();
    expect(await getKeyMode()).toBe('device');
    expect(await readKey()).toBe(key);
  });

  it('seals: the plain copy goes, biometrics release the key, unseal brings it back', async () => {
    const key = await freshKey();
    await sealKey('correct horse battery');
    expect(await getKeyMode()).toBe('sealed');
    expect(mockStore.items.has(PLAIN)).toBe(false);
    expect(await readKey()).toBe(key);
    await unsealKey();
    expect(await getKeyMode()).toBe('device');
    expect(mockStore.items.get(PLAIN)).toBe(key);
  });

  it('a cancelled prompt is locked, a changed enrolment is invalidated, and recovery works', async () => {
    const key = await freshKey();
    await sealKey('correct horse battery');
    mockStore.biometrics = 'cancel';
    await expect(readKey()).rejects.toMatchObject({ invalidated: false });
    mockStore.biometrics = 'invalidated';
    const err = await readKey().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyLockedError);
    expect((err as KeyLockedError).invalidated).toBe(true);
    await expect(recoverKey('wrong words here')).rejects.toThrow(/isn't right/);
    await recoverKey('correct horse battery');
    expect(await getKeyMode()).toBe('device');
    expect(await readKey()).toBe(key);
  });

  it('retries removing the plain key when sealing', async () => {
    await freshKey();
    mockStore.failDeletes = 2;
    await sealKey('correct horse battery');
    expect(mockStore.items.has(PLAIN)).toBe(false);
  });

  it('says so if the plain key could not be removed, and removes it on the next launch', async () => {
    const key = await freshKey();
    mockStore.failDeletes = 5;
    await expect(sealKey('correct horse battery')).rejects.toBeInstanceOf(SealIncompleteError);
    expect(await getKeyMode()).toBe('sealed');
    expect(mockStore.items.has(PLAIN)).toBe(true);
    mockStore.failDeletes = 0;
    expect(await readKey()).toBe(key);
    expect(mockStore.items.has(PLAIN)).toBe(false);
  });
  it('changes nothing when the seal prompt is cancelled', async () => {
    const key = await freshKey();
    mockStore.biometrics = 'cancel';
    await expect(sealKey('correct horse battery')).rejects.toThrow(/cancelled/);
    expect(await getKeyMode()).toBe('device');
    expect(mockStore.items.get(PLAIN)).toBe(key);
    expect(await hasRecovery()).toBe(true); // harmless: unused until the mode says sealed
    expect(mockStore.items.size).toBe(2);
    mockStore.biometrics = 'ok';
    expect(await readKey()).toBe(key);
  });

  it('refuses to seal without a key, and sealing or unsealing twice does nothing more', async () => {
    await expect(sealKey('correct horse battery')).rejects.toThrow(/No catalog key/);
    const key = await freshKey();
    await unsealKey();
    expect(await getKeyMode()).toBe('device');
    await sealKey('correct horse battery');
    await sealKey('another phrase entirely');
    // The second call was a no-op, so the first passphrase still recovers.
    mockStore.biometrics = 'invalidated';
    await recoverKey('correct horse battery');
    expect(await readKey()).toBe(key);
  });

  it('unsealing drops the old recovery passphrase; sealing again uses only the new one', async () => {
    const key = await freshKey();
    await sealKey('first phrase here');
    expect(await hasRecovery()).toBe(true);
    await unsealKey();
    expect(await hasRecovery()).toBe(false);
    await expect(recoverKey('first phrase here')).rejects.toThrow(/No recovery passphrase/);
    await sealKey('second phrase here');
    mockStore.biometrics = 'invalidated';
    await expect(recoverKey('first phrase here')).rejects.toThrow(/isn't right/);
    await recoverKey('second phrase here');
    expect(await getKeyMode()).toBe('device');
    expect(await hasRecovery()).toBe(false);
    expect(await readKey()).toBe(key);
  });

  it('a sealed key can be locked out and recovered more than once', async () => {
    const key = await freshKey();
    for (const phrase of ['round one words', 'round two words']) {
      await sealKey(phrase);
      mockStore.biometrics = 'invalidated';
      await expect(readKey()).rejects.toBeInstanceOf(KeyLockedError);
      await recoverKey(phrase);
      mockStore.biometrics = 'ok';
      expect(await readKey()).toBe(key);
    }
  });

  it('forgets every key and the recovery copy', async () => {
    await freshKey();
    await sealKey('correct horse battery');
    await forgetKeys();
    expect(mockStore.items.size).toBe(0);
    expect(await getKeyMode()).toBe('device');
    expect(await readKey()).toBeNull();
  });
});
