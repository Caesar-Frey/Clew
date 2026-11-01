import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/** A photo ready to store: JPEG bytes as base64, plus a small thumbnail. */
export interface CapturedPhoto {
  data: string;
  thumb: string;
  width: number;
  height: number;
  /** The picked file, for on-device analysis (box fingerprints, AI) before it's discarded. */
  uri: string;
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
  if (result.canceled || !result.assets[0]) return null;
  return shrink(result.assets[0].uri, result.assets[0].width, result.assets[0].height);
}

export async function shrink(uri: string, width: number, height: number): Promise<CapturedPhoto> {
  const landscape = width >= height;
  const fit = (max: number) => (landscape ? { width: Math.min(max, width) } : { height: Math.min(max, height) });

  const full = await ImageManipulator.manipulate(uri).resize(fit(FULL)).renderAsync();
  // Re-encoding also drops EXIF, including any GPS position.
  const saved = await full.saveAsync({ format: SaveFormat.JPEG, compress: 0.72, base64: true });
  const small = await ImageManipulator.manipulate(uri).resize(fit(THUMB)).renderAsync();
  const thumb = await small.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
  if (!saved.base64 || !thumb.base64) throw new Error("Couldn't read that photo.");
  return { data: saved.base64, thumb: thumb.base64, width: saved.width, height: saved.height, uri: saved.uri };
}

export const jpegUri = (base64: string) => `data:image/jpeg;base64,${base64}`;
