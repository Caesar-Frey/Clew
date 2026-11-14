import { gcm } from "@noble/ciphers/aes.js";

import { ARCHIVE_EXTENSION, type Aead } from "./archive";

/** Browser design preview only: a JS cipher and a download link. */
export const nativeAead: Aead = {
  seal: async (key, nonce, data, aad) => gcm(key, nonce, aad).encrypt(data),
  open: async (key, nonce, data, aad) => gcm(key, nonce, aad).decrypt(data),
};

export const randomBytes = (n: number) =>
  crypto.getRandomValues(new Uint8Array(n));

let lastUrl: string | null = null;

function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = `Clew.${ARCHIVE_EXTENSION}`;
  a.click();
}

export async function shareArchive(
  bytes: Uint8Array,
  _now: number,
): Promise<string> {
  lastUrl = URL.createObjectURL(new Blob([bytes as BlobPart]));
  download(lastUrl);
  return lastUrl;
}

export async function shareAgain(uri: string): Promise<void> {
  download(uri);
}

export function discardShared(uri: string | null): void {
  if (uri) URL.revokeObjectURL(uri);
  if (uri === lastUrl) lastUrl = null;
}

export async function pickArchive(): Promise<{
  name: string;
  bytes: Uint8Array;
} | null> {
  return null;
}
