import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { deleteQuietly } from './tempFiles';

/** A photo ready to store: JPEG bytes as base64, plus a small thumbnail. */
export interface CapturedPhoto {
  data: string;
  thumb: string;
  width: number;
  height: number;
}

/** Long edge of the stored photo: sharp enough to read a label, small enough to back up. */
const FULL = 1600;
const THUMB = 240;

export class CameraPermissionError extends Error {
  constructor() {
    super('Allow camera access for Clew in Settings to take photos.');
    this.name = 'CameraPermissionError';
  }
}

/**
 * Takes or picks a photo and shrinks it. Photos are kept inside the encrypted
 * database (not as loose files), so they're protected and backed up like
 * everything else.
 */
export async function capturePhoto(source: 'camera' | 'library'): Promise<CapturedPhoto | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new CameraPermissionError();
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false, allowsEditing: false };
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  try {
    return await shrink(asset.uri, asset.width, asset.height);
  } finally {
    // The camera's original is plaintext on disk; from a library pick it's a cache copy.
    if (source === 'camera' || asset.uri.includes('/ImagePicker/')) deleteQuietly(asset.uri);
  }
}

/**
 * Re-encodes a photo to the stored size and a thumbnail, reading both as
 * base64 and deleting every file the image tools wrote along the way.
 */
export async function shrink(uri: string, width: number, height: number): Promise<CapturedPhoto> {
  const landscape = width >= height;
  const fit = (max: number) => (landscape ? { width: Math.min(max, width) } : { height: Math.min(max, height) });
  const written: string[] = [];
  try {
    const full = await ImageManipulator.manipulate(uri).resize(fit(FULL)).renderAsync();
    // Re-encoding also drops EXIF, including any GPS position.
    const saved = await full.saveAsync({ format: SaveFormat.JPEG, compress: 0.72, base64: true });
    written.push(saved.uri);
    const small = await ImageManipulator.manipulate(uri).resize(fit(THUMB)).renderAsync();
    const thumb = await small.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
    written.push(thumb.uri);
    if (!saved.base64 || !thumb.base64) throw new Error("Couldn't read that photo.");
    return { data: saved.base64, thumb: thumb.base64, width: saved.width, height: saved.height };
  } finally {
    written.forEach(deleteQuietly);
  }
}

export const jpegUri = (base64: string) => `data:image/jpeg;base64,${base64}`;
