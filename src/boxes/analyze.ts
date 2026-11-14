import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { extractTextFromImage, isSupported } from 'expo-text-extractor';
import jpeg from 'jpeg-js';

import { base64ToBytes } from '../lib/base64';
import { centreSquare, labelText, labelWords, visualFeatures, type FingerprintView } from './fingerprint';

const SIZE = 48;

/** What happened when reading writing off the photo. */
export type OcrResult = 'read' | 'none' | 'failed' | 'unavailable';

export interface BoxAnalysis {
  view: FingerprintView;
  ocr: OcrResult;
}

/**
 * Reads a box photo on the device: text on the label (Apple Vision / ML Kit,
 * on-device) and a tiny centre-cropped thumbnail for the colour features.
 * Nothing is sent anywhere.
 */
export async function analyzeBoxPhoto(uri: string): Promise<BoxAnalysis> {
  const [text, pixels] = await Promise.all([readText(uri), thumbnailPixels(uri)]);
  const lines = text.lines;
  return {
    view: { ...visualFeatures(pixels.data, pixels.width, pixels.height), words: labelWords(lines), text: labelText(lines) },
    ocr: text.ocr,
  };
}

async function readText(uri: string): Promise<{ lines: string[]; ocr: OcrResult }> {
  if (!isSupported) return { lines: [], ocr: 'unavailable' };
  try {
    const lines = await extractTextFromImage(uri);
    return { lines, ocr: labelWords(lines).length ? 'read' : 'none' };
  } catch {
    return { lines: [], ocr: 'failed' };
  }
}

async function thumbnailPixels(uri: string) {
  // Crop to a centred square first so the 4×4 layout isn't squashed by the
  // photo's aspect ratio (portrait and landscape shots of a box then agree).
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const [originX, originY, size] = centreSquare(original.width, original.height);
  const ref = await ImageManipulator.manipulate(uri)
    .crop({ originX, originY, width: size, height: size })
    .resize({ width: SIZE, height: SIZE })
    .renderAsync();
  const small = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.95, base64: true });
  const decoded = jpeg.decode(base64ToBytes(small.base64 ?? ''), { useTArray: true, formatAsRGBA: true });
  return { data: decoded.data as Uint8Array, width: decoded.width, height: decoded.height };
}
