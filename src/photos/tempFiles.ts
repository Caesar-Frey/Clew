import { Directory, File, Paths } from 'expo-file-system';

import { base64ToBytes } from '../lib/base64';

/**
 * Photos only ever live inside the encrypted database. Anything the camera,
 * picker or image tools write to disk on the way is plaintext, so it is
 * deleted as soon as it has been read, and swept on every app start in case
 * the app was killed mid-way.
 */

/** Our own short-lived files (e.g. a JPEG handed to OCR or the model). */
const TEMP_DIR = 'clew-tmp';

/** Cache folders that expo-image-picker, expo-image-manipulator and the document picker write into. */
export const PLAINTEXT_CACHE_DIRS = ['ImagePicker', 'ImageManipulator', 'DocumentPicker', TEMP_DIR];

/** Deletes a file by uri; never throws. */
export function deleteQuietly(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone, or not ours to delete: the start-up sweep catches leftovers.
  }
}

/** Writes base64 JPEG to a private temp file, runs `fn` with its uri, then deletes it. */
export async function withTempJpeg<T>(base64: string, fn: (uri: string) => Promise<T>): Promise<T> {
  const dir = new Directory(Paths.cache, TEMP_DIR);
  let file: File | null = null;
  try {
    if (!dir.exists) dir.create({ intermediates: true });
    file = new File(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    file.create();
    await file.write(base64ToBytes(base64));
    return await fn(file.uri);
  } finally {
    deleteQuietly(file?.uri);
  }
}

/** Removes everything left in the plaintext cache folders. Call once at start-up. */
export function sweepPlaintextCaches(): void {
  for (const name of PLAINTEXT_CACHE_DIRS) {
    try {
      const dir = new Directory(Paths.cache, name);
      if (dir.exists) dir.delete();
    } catch {
      // Try again next launch.
    }
  }
}
