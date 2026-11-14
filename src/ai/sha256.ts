import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Reads the next chunk of a file; returns an empty array at the end. */
export type ChunkReader = (length: number) => Promise<Uint8Array>;

const CHUNK = 4 * 1024 * 1024;

/**
 * Streams a file through SHA-256 in 4 MB chunks so a 1 GB model never sits in
 * memory at once. `onProgress` receives bytes hashed so far.
 */
export async function sha256Stream(read: ChunkReader, onProgress?: (bytes: number) => void): Promise<string> {
  const h = sha256.create();
  let done = 0;
  for (;;) {
    const chunk = await read(CHUNK);
    if (chunk.length === 0) break;
    h.update(chunk);
    done += chunk.length;
    onProgress?.(done);
  }
  return bytesToHex(h.digest());
}
