import { gcm } from '@noble/ciphers/aes.js';

import { ARCHIVE_EXTENSION, type Aead } from './archive';

/** Browser design preview only: a JS cipher and a download link. */
export const nativeAead: Aead = {
  seal: async (key, nonce, data, aad) => gcm(key, nonce, aad).encrypt(data),
  open: async (key, nonce, data, aad) => gcm(key, nonce, aad).decrypt(data),
};

export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export async function shareArchive(bytes: Uint8Array): Promise<void> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = document.createElement('a');
  a.href = url;
  a.download = `Clew.${ARCHIVE_EXTENSION}`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function pickArchive(): Promise<{ name: string; bytes: Uint8Array } | null> {
  return null;
}
