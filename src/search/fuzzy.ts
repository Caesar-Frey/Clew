/**
 * Small, dependency-free fuzzy matcher tuned for short names typed on a phone:
 * prefix-as-you-type, substrings, missing letters ("scrwdrvr") and one or two
 * typos ("screwdirver"). Every word in the query must match somewhere.
 */

/** Letters that NFD doesn't take apart, folded to plain Latin. */
const FOLD: Record<string, string> = { ł: 'l', ø: 'o', đ: 'd', ð: 'd', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th', ı: 'i', ħ: 'h', ŧ: 't', ĸ: 'k', ŋ: 'n' };
const FOLD_RE = new RegExp(`[${Object.keys(FOLD).join('')}]`, 'g');

/**
 * Lower case, accents off, special letters folded (ł→l, ß→ss), and anything
 * that isn't a letter, mark or digit becomes a space. Combining marks that
 * aren't Latin accents (e.g. Devanagari vowel signs) stay inside the word.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(FOLD_RE, (c) => FOLD[c] ?? c)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .normalize('NFC');
}

/** Tokens by text: a catalog re-index only tokenises text it hasn't seen. */
const tokenCache = new Map<string, string[]>();

export function tokenize(text: string): string[] {
  const hit = tokenCache.get(text);
  if (hit) return hit;
  const n = normalize(text);
  const tokens = n ? n.split(' ') : [];
  if (tokenCache.size > 60_000) tokenCache.clear();
  tokenCache.set(text, tokens);
  return tokens;
}

let rowA = new Int32Array(32);
let rowB = new Int32Array(32);
let rowC = new Int32Array(32);

/** Optimal string alignment distance, bailing out once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length + 1;
  if (rowA.length < n) {
    rowA = new Int32Array(n * 2);
    rowB = new Int32Array(n * 2);
    rowC = new Int32Array(n * 2);
  }
  let prev2 = rowA;
  let prev = rowB;
  let cur = rowC;
  for (let j = 0; j < n; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j < n; j++) {
      const bj = b.charCodeAt(j - 1);
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (ai === bj ? 0 : 1));
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj) v = Math.min(v, prev2[j - 2]! + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev2;
    prev2 = prev;
    prev = cur;
    cur = t;
  }
  return prev[b.length]!;
}

const bag = new Int16Array(65536);

/**
 * Letters of `q` that `t` can't supply (counting repeats). Every edit fixes
 * at most one, so more than `max` rules out a match within `max` edits,
 * against `t` or any prefix of it.
 */
function missingLetters(q: string, t: string, max: number): number {
  for (let i = 0; i < t.length; i++) bag[t.charCodeAt(i)]!++;
  let missing = 0;
  for (let i = 0; i < q.length; i++) {
    const c = q.charCodeAt(i);
    if (bag[c]! > 0) bag[c]!--;
    else if (++missing > max) break;
  }
  for (let i = 0; i < t.length; i++) bag[t.charCodeAt(i)] = 0;
  return missing;
}

function isSubsequence(q: string, t: string): boolean {
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) if (q[i] === t[j]) i++;
  return i === q.length;
}

/** How well one query word matches one word of the text, 0..1. */
export function scoreToken(q: string, t: string): number {
  if (q === t) return 1;
  if (t.startsWith(q)) return 0.75 + 0.2 * (q.length / t.length);
  if (q.length >= 2 && t.includes(q)) return 0.6;
  if (q.length >= 3) {
    const max = q.length >= 8 ? 2 : 1;
    // Compare against the whole word and against a same-length prefix, so a
    // typo in a half-typed word still matches.
    if (q.length >= 4 && missingLetters(q, t, max) <= max) {
      const d = Math.min(editDistance(q, t, max), editDistance(q, t.slice(0, q.length), max));
      if (d <= max) return 0.55 - 0.1 * d;
    }
    if (q[0] === t[0] && isSubsequence(q, t) && q.length / t.length >= 0.5) return 0.35;
  }
  return 0;
}

export interface SearchField {
  text: string;
  weight: number;
}

/** A field already turned into vocabulary ids (see `prepareFields`). */
export interface PreparedField {
  ids: number[];
  weight: number;
}

export interface SearchDoc<T> {
  value: T;
  /** Raw fields, or `prepared` from an earlier `prepareFields` call. */
  fields?: SearchField[];
  prepared?: PreparedField[];
  /** Tie-breaker: higher wins (e.g. last updated). */
  rank?: number;
}

interface PreparedDoc<T> {
  value: T;
  rank: number;
  fields: PreparedField[];
}

export interface SearchIndex<T> {
  search(query: string, limit?: number): { value: T; score: number }[];
  size: number;
}

/*
 * Words repeat a lot across a catalog (place names, tags), so every distinct
 * word gets an id in one shared vocabulary, each query word is scored once
 * per distinct word, and documents just look scores up. Prepared fields can
 * be kept between rebuilds; `vocabGeneration` changes if the ids reset.
 */
let vocab: string[] = [];
let idOf = new Map<string, number>();
let generation = 0;
const MAX_VOCAB = 200_000;

export function vocabGeneration(): number {
  return generation;
}

function wordId(t: string): number {
  let n = idOf.get(t);
  if (n === undefined) {
    n = vocab.length;
    vocab.push(t);
    idOf.set(t, n);
  }
  return n;
}

export function prepareFields(fields: SearchField[]): PreparedField[] {
  if (vocab.length > MAX_VOCAB) {
    vocab = [];
    idOf = new Map();
    generation += 1;
  }
  return fields.map((f) => ({ ids: tokenize(f.text).map(wordId), weight: f.weight }));
}

export function createSearchIndex<T>(docs: SearchDoc<T>[]): SearchIndex<T> {
  const gen = generation;
  const prepared: PreparedDoc<T>[] = docs.map((d) => ({
    value: d.value,
    rank: d.rank ?? 0,
    fields: d.prepared ?? prepareFields(d.fields ?? []),
  }));
  // A reset during preparation would mix id spaces; prepare again from text.
  if (generation !== gen) {
    for (let i = 0; i < docs.length; i++) prepared[i]!.fields = prepareFields(docs[i]!.fields ?? []);
  }

  function scoresFor(q: string): Float32Array {
    const words = vocab;
    const out = new Float32Array(words.length);
    for (let i = 0; i < words.length; i++) out[i] = scoreToken(q, words[i]!);
    return out;
  }

  function search(query: string, limit = 50) {
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return [];
    const tables = qTokens.map(scoresFor);
    const results: { value: T; score: number; rank: number }[] = [];
    for (const doc of prepared) {
      let total = 0;
      let matchedAll = true;
      for (const table of tables) {
        let best = 0;
        for (const field of doc.fields) {
          for (const t of field.ids) {
            const s = (table[t] ?? 0) * field.weight;
            if (s > best) best = s;
          }
        }
        if (best === 0) {
          matchedAll = false;
          break;
        }
        total += best;
      }
      if (matchedAll) results.push({ value: doc.value, score: total / tables.length, rank: doc.rank });
    }
    results.sort((a, b) => b.score - a.score || b.rank - a.rank);
    return results.slice(0, limit).map(({ value, score }) => ({ value, score }));
  }

  return { search, size: prepared.length };
}
