import { normalize, scoreToken, tokenize } from '../search/fuzzy';

/**
 * Box fingerprints: recognising a box from a photo of the box itself or its
 * handwritten label, with no QR codes or printed stickers.
 *
 * Each photo becomes a "view": the words read off it (on-device OCR), a
 * colour histogram (robust to angle and distance) and a coarse 4×4 colour
 * layout. A box keeps several views. A new photo is compared with every
 * view of every box; label words count most when both sides have them.
 */
export const FINGERPRINT_MODEL = 'wb-fp-1';

export interface FingerprintView {
  /** Normalised words read from the photo. */
  words: string[];
  /** The text as read, for showing ("Label reads: …"). */
  text: string;
  /** Hue/saturation/value histogram, L1-normalised. */
  hist: number[];
  /** 4×4 grid of mean RGB (0..1), row-major. */
  grid: number[];
  /** The stored photo this view came from, so it can be removed with the view. */
  photoId?: string;
}

export interface Fingerprint {
  v: 1;
  views: FingerprintView[];
}

export const MAX_VIEWS = 6;

/* ------------------------------------------------------------- features */

const HUE_BINS = 12;
const SAT_BINS = 2;
const VAL_BINS = 3;
const GRAY_BINS = 4;
const HIST_SIZE = HUE_BINS * SAT_BINS * VAL_BINS + GRAY_BINS;

/**
 * Visual features from RGBA pixels (e.g. a 48×48 thumbnail, centre-cropped to
 * a square). Each pixel's colour is spread over its two nearest hue and value
 * bins (triangular soft-binning), so a box shot under slightly different
 * light doesn't jump to a different bin and stop matching.
 */
export function visualFeatures(rgba: Uint8Array, width: number, height: number): Pick<FingerprintView, 'hist' | 'grid'> {
  const hist = new Array<number>(HIST_SIZE).fill(0);
  const grid = new Array<number>(48).fill(0);
  const counts = new Array<number>(16).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i]! / 255;
      const g = rgba[i + 1]! / 255;
      const b = rgba[i + 2]! / 255;
      // The centre of the frame is usually the box; the edges are the room.
      const cx = (x + 0.5) / width - 0.5;
      const cy = (y + 0.5) / height - 0.5;
      const w = 1.5 - Math.min(1, Math.sqrt(cx * cx + cy * cy) * 2);
      addSoft(hist, r, g, b, w);
      const cell = Math.min(3, Math.floor((y / height) * 4)) * 4 + Math.min(3, Math.floor((x / width) * 4));
      grid[cell * 3]! += r;
      grid[cell * 3 + 1]! += g;
      grid[cell * 3 + 2]! += b;
      counts[cell]!++;
    }
  }
  const total = hist.reduce((a, v) => a + v, 0) || 1;
  return {
    hist: hist.map((v) => round(v / total)),
    grid: grid.map((v, i) => round(v / (counts[Math.floor(i / 3)] || 1))),
  };
}

/** Splits a continuous bin position between its two nearest bins. */
function spread(pos: number, bins: number, wrap: boolean): [number, number, number, number] {
  const centre = pos * bins - 0.5;
  let lo = Math.floor(centre);
  const frac = centre - lo;
  let hi = lo + 1;
  if (wrap) {
    lo = (lo + bins) % bins;
    hi = hi % bins;
  } else {
    lo = Math.max(0, Math.min(bins - 1, lo));
    hi = Math.max(0, Math.min(bins - 1, hi));
  }
  return [lo, 1 - frac, hi, frac];
}

function addSoft(hist: number[], r: number, g: number, b: number, weight: number): void {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  const s = max === 0 ? 0 : (max - min) / max;
  // Greys, black and white: hue is meaningless, bin by brightness only.
  if (s < 0.18 || v < 0.12) {
    const [lo, wl, hi, wh] = spread(v, GRAY_BINS, false);
    hist[HUE_BINS * SAT_BINS * VAL_BINS + lo]! += weight * wl;
    hist[HUE_BINS * SAT_BINS * VAL_BINS + hi]! += weight * wh;
    return;
  }
  let h: number;
  const d = max - min;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  const sb = Math.min(SAT_BINS - 1, Math.floor(((s - 0.18) / 0.82) * SAT_BINS));
  const [h0, wh0, h1, wh1] = spread(h / 6, HUE_BINS, true);
  const [v0, wv0, v1, wv1] = spread((v - 0.12) / 0.88, VAL_BINS, false);
  const bin = (hb: number, vb: number) => (hb * SAT_BINS + sb) * VAL_BINS + vb;
  hist[bin(h0, v0)]! += weight * wh0 * wv0;
  hist[bin(h0, v1)]! += weight * wh0 * wv1;
  hist[bin(h1, v0)]! += weight * wh1 * wv0;
  hist[bin(h1, v1)]! += weight * wh1 * wv1;
}

/** Largest centred square, as [x, y, size], for cropping before the 4×4 grid. */
export function centreSquare(width: number, height: number): [number, number, number] {
  const size = Math.min(width, height);
  return [Math.floor((width - size) / 2), Math.floor((height - size) / 2), size];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Words worth matching on from OCR lines (drops noise like "1" or "|"). */
export function labelWords(lines: string[]): string[] {
  const seen = new Set<string>();
  for (const t of tokenize(lines.join(' '))) if (t.length >= 2 && !/^\d$/.test(t)) seen.add(t);
  return [...seen].slice(0, 40);
}

export function labelText(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' · ')
    .slice(0, 200);
}

/* ----------------------------------------------------------- similarity */

/**
 * Words printed on lots of cartons. They say little about which box this is,
 * so they count for a fifth of a handwritten word and never prove a match.
 */
const GENERIC_WORDS = new Set(
  (
    'fragile handle with care this side up way top bottom open here keep dry heavy box boxes carton cartons ' +
    'amazon prime ikea ups fedex dhl usps royal mail parcel post shipping ship deliver delivery packing package ' +
    'packaged made in china recycle recyclable cardboard corrugated contents qty quantity weight kg lbs net gross ' +
    'small medium large xl the and for of to'
  ).split(' '),
);

export const isGenericWord = (w: string) => GENERIC_WORDS.has(w);

const wordWeight = (w: string) => (isGenericWord(w) ? 0.2 : 1);

function bestToken(w: string, candidate: string[]): number {
  let best = 0;
  for (const c of candidate) best = Math.max(best, scoreToken(w, c), scoreToken(c, w));
  return best;
}

export function textSimilarity(query: string[], candidate: string[]): number {
  const q = query.filter((w) => w.length >= 3);
  if (q.length === 0 || candidate.length === 0) return 0;
  let total = 0;
  let weights = 0;
  for (const w of q) {
    const weight = wordWeight(w);
    total += weight * bestToken(w, candidate);
    weights += weight;
  }
  return Math.min(1, total / weights);
}

/** Distinctive (non-generic) words the two photos share, allowing for misreads. */
export function sharedWords(query: string[], candidate: string[]): number {
  return query.filter((w) => w.length >= 3 && !isGenericWord(w) && bestToken(w, candidate.filter((c) => !isGenericWord(c))) >= 0.55)
    .length;
}

/** Histogram intersection, 0..1. */
export function histSimilarity(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += Math.min(a[i]!, b[i]!);
  return s;
}

export function gridSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - b[i]!);
  return Math.max(0, 1 - (d / a.length) * 2.5);
}

export interface ViewScore {
  score: number;
  /** Look alone, 0..1. */
  visual: number;
  /** Distinctive words both photos show. */
  shared: number;
}

export function compareViews(query: FingerprintView, view: FingerprintView): ViewScore {
  const visual = 0.75 * histSimilarity(query.hist, view.hist) + 0.25 * gridSimilarity(query.grid, view.grid);
  const queryHasText = query.words.some((w) => w.length >= 3);
  const shared = sharedWords(query.words, view.words);
  // A label in the new photo that this view never showed: could be the box
  // from another side, but less likely.
  if (queryHasText && view.words.length === 0) return { score: 0.85 * visual, visual, shared };
  if (!queryHasText) return { score: visual, visual, shared };
  const text = textSimilarity(query.words, view.words);
  // Matching handwriting is strong evidence; different writing is strong
  // evidence against.
  return { score: 0.6 * text + 0.4 * visual, visual, shared };
}

export function viewSimilarity(query: FingerprintView, view: FingerprintView): number {
  return compareViews(query, view).score;
}

export interface BoxMatch<T> extends ViewScore {
  value: T;
}

/** Best-first matches for a new photo among fingerprinted boxes. */
export function rankBoxes<T>(query: FingerprintView, boxes: { value: T; fingerprint: Fingerprint }[]): BoxMatch<T>[] {
  return boxes
    .map(({ value, fingerprint }) => {
      let best: ViewScore = { score: 0, visual: 0, shared: 0 };
      for (const v of fingerprint.views) {
        const s = compareViews(query, v);
        if (s.score > best.score) best = s;
      }
      return { value, ...best };
    })
    .sort((a, b) => b.score - a.score);
}

export type MatchStrength = 'strong' | 'possible' | 'weak';

/** How far ahead of the runner-up the top box must be to be called likely. */
export const STRONG_MARGIN = 0.06;

/**
 * Only the top candidate can be "strong", and only when it is clearly ahead
 * of the next one AND either a distinctive word matches or the look is very
 * close. Colour alone never makes a strong match with a lookalike nearby.
 * Even a strong match is shown for the user to confirm.
 */
export function matchStrength(matches: BoxMatch<unknown>[], i = 0): MatchStrength {
  const m = matches[i];
  if (!m) return 'weak';
  if (i === 0) {
    const next = matches[1]?.score ?? 0;
    const evidence = m.shared >= 1 || m.visual >= 0.8;
    if (m.score >= 0.62 && m.score - next >= STRONG_MARGIN && evidence) return 'strong';
  }
  if (m.score >= 0.45) return 'possible';
  return 'weak';
}

/* --------------------------------------------------------------- storage */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeFingerprint(fp: Fingerprint): Uint8Array {
  return encoder.encode(JSON.stringify(fp));
}

export function decodeFingerprint(bytes: Uint8Array | null): Fingerprint | null {
  if (!bytes || bytes.length === 0) return null;
  try {
    const fp = JSON.parse(decoder.decode(bytes)) as Fingerprint;
    return fp?.v === 1 && Array.isArray(fp.views) ? fp : null;
  } catch {
    return null;
  }
}

export function addView(fp: Fingerprint | null, view: FingerprintView): Fingerprint {
  return addViewDropping(fp, view).fingerprint;
}

/** Adds a view, keeping the newest MAX_VIEWS; also returns the views that fell off. */
export function addViewDropping(fp: Fingerprint | null, view: FingerprintView): { fingerprint: Fingerprint; dropped: FingerprintView[] } {
  const views = [...(fp?.views ?? []), view];
  const cut = Math.max(0, views.length - MAX_VIEWS);
  return { fingerprint: { v: 1, views: views.slice(cut) }, dropped: views.slice(0, cut) };
}

/** All words on a box's labels, for text search ("camping" finds the box marked CAMPING). */
export function fingerprintText(fp: Fingerprint | null): string {
  return fp ? normalize(fp.views.map((v) => v.text).join(' ')) : '';
}
