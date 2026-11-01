import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { ARCHIVE_EXTENSION, type Aead } from './archive';

/** AES-256-GCM from the platform crypto library (fast for photo-heavy archives). */
export const nativeAead: Aead = {
  async seal(key, nonce, plaintext, aad) {
    const k = await Crypto.AESEncryptionKey.import(key);
    const sealed = await Crypto.aesEncryptAsync(plaintext, k, { nonce: { bytes: nonce }, additionalData: aad, tagLength: 16 });
    return sealed.ciphertext({ includeTag: true });
  },
  async open(key, nonce, sealed, aad) {
    const k = await Crypto.AESEncryptionKey.import(key);
    const data = Crypto.AESSealedData.fromParts(nonce, sealed, 16);
    return Crypto.aesDecryptAsync(data, k, { additionalData: aad });
  },
};

export const randomBytes = (n: number) => Crypto.getRandomBytesAsync(n);

function fileName(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Clew ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.${ARCHIVE_EXTENSION}`;
}

/**
 * Hands the sealed archive to the share sheet (Save to Files, Drive, AirDrop,
 * email...). The temporary copy is removed afterwards.
 */
export async function shareArchive(bytes: Uint8Array, now: number): Promise<void> {
  const file = new File(Paths.cache, fileName(now));
  if (file.exists) file.delete();
  file.create();
  await file.write(bytes);
  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/octet-stream',
      UTI: 'public.data',
      dialogTitle: 'Save your Clew backup',
    });
  } finally {
    try {
      file.delete();
    } catch {
      // The OS cleans the cache directory eventually.
    }
  }
}

/** Lets the user choose an archive. Returns null if they cancel. */
export async function pickArchive(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  try {
    if ((file.size ?? 0) > 512 * 1024 * 1024) throw new Error('That file is too large to be a Clew backup.');
    return { name: asset.name, bytes: await file.bytes() };
  } finally {
    try {
      file.delete();
    } catch {
      // Picked file lives in the cache; fine to leave.
    }
  }
}
