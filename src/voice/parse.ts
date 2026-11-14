import type { Location } from '../db/types';
import type { LocationIndex } from '../lib/locations';
import { normalize } from '../search/fuzzy';

/**
 * Turns a spoken sentence into a catalog card:
 *   "the passport is in the desk drawer in the bedroom"
 *     -> name "Passport", place "Bedroom › Desk drawer"
 *   "I lent the drill to Sam for two weeks"
 *     -> name "Drill", lent to "Sam", due in 14 days
 * English only for now. Anything it can't place is left for the user to fill.
 */
export interface SpokenCard {
  name: string;
  /** Place names, root first; matched to existing places where possible. */
  place: string[];
  person: string | null;
  dueInDays: number | null;
}

const FILLER = /^(?:(?:ok(?:ay)?|so|um+|uh+|right|alright|hey|well|and|note that|remember(?: that)?)[\s,]+)+/i;
const ARTICLE = /^(?:the|my|our|a|an|some|his|her|their)\s+/i;
/** Kept as part of the place's name: "Under the bed" is a place, "the bed" isn't where it is. */
const KEPT_PREPOSITION = /^(under(?:neath)?|behind|beside|next to|on top of|above|below|in front of|between)\s+/i;
const PLACE_PREPOSITION = /\s+(?:is|are|'s|was|were|goes|go|lives|live|sits|sit)?\s*(?:kept\s+|stored\s+|put\s+|left\s+)?(?:in(?:side)?|on|at|into|onto|under(?:neath)?|behind|beside|next to|on top of|above|below|in front of|between)\s+/i;

const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };

function clean(s: string): string {
  return s
    .trim()
    .replace(/[.!?,;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripArticle(s: string): string {
  return clean(s).replace(ARTICLE, '');
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function properName(s: string): string {
  return stripArticle(s)
    .split(' ')
    .map((w) => capitalize(w))
    .join(' ');
}

/** "for two weeks", "until tomorrow", "for 3 days", "till next month" */
function parseDue(text: string): { rest: string; days: number | null } {
  const m = text.match(
    /\s+(?:for|until|till|til|by|due|back in|back by|due in)\s+(?:(?:about|around)\s+)?(?:(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)\s+(?:of\s+)?(day|week|month)s?|(tomorrow|next week|next month|the weekend|the end of the week))\s*$/i,
  );
  if (!m) return { rest: text, days: null };
  let days: number;
  if (m[3]) {
    const word = m[3].toLowerCase();
    days = word === 'tomorrow' ? 1 : word === 'next month' ? 30 : 7;
  } else {
    const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : (NUMBERS[m[1]!.toLowerCase()] ?? 1);
    const unit = m[2]!.toLowerCase();
    days = n * (unit === 'week' ? 7 : unit === 'month' ? 30 : 1);
  }
  return { rest: text.slice(0, m.index), days: Math.min(days, 365) };
}

/** "the blue box in the garage" -> ["Garage", "Blue box"] */
export function splitPlace(text: string): string[] {
  const parts: string[] = [];
  let rest = clean(text);
  // Spoken outermost-last: "blue box in the garage" -> ["Garage", "Blue box"].
  // A typed or spoken path ("garage greater than blue box") wins.
  if (/[>›/]|\bgreater than\b/i.test(rest)) {
    return rest
      .split(/\s*(?:[>›/]|\bgreater than\b)\s*/i)
      .map((p) => capitalize(stripArticle(p)))
      .filter(Boolean);
  }
  for (;;) {
    const m = rest.match(/\s+(?:in(?:side)?|on|at|of)\s+(?=\S)/i);
    if (!m || m.index === undefined) break;
    parts.unshift(rest.slice(0, m.index));
    rest = rest.slice(m.index + m[0].length);
  }
  parts.unshift(rest);
  return parts
    .map((p) => {
      const kept = p.match(KEPT_PREPOSITION);
      const body = stripArticle(kept ? p.slice(kept[0].length) : p);
      return capitalize(kept ? `${kept[1]!.toLowerCase()} the ${body}` : body);
    })
    .filter(Boolean);
}

export function parseSpokenCard(raw: string): SpokenCard {
  let text = clean(raw).replace(FILLER, '');
  const empty = { place: [] as string[], person: null, dueInDays: null };

  // Lending.
  const due = parseDue(text);
  const lent = due.rest.match(/^(?:i\s+)?(?:lent|loaned|gave|lend|loan)\s+(.+?)\s+to\s+(.+)$/i);
  if (lent && lent[1] && lent[2]) {
    return { name: capitalize(stripArticle(lent[1])), place: [], person: properName(lent[2]), dueInDays: due.days };
  }
  const has = due.rest.match(/^(.+?)\s+(?:has|borrowed|took|is borrowing|has got)\s+(.+)$/i);
  if (has && has[1] && has[2] && !/^(?:it|this|that)$/i.test(stripArticle(has[1]))) {
    return { name: capitalize(stripArticle(has[2])), place: [], person: properName(has[1]), dueInDays: due.days };
  }

  // Putting away: "I put X in Y", "X is in Y", "X in Y".
  text = text.replace(/^(?:i(?:'ve| have)?\s+)?(?:put|placed|stored|left|kept|moved|stashed|hid)\s+/i, '');
  const at = text.match(PLACE_PREPOSITION);
  if (at && at.index !== undefined && at.index > 0) {
    const name = text.slice(0, at.index);
    let placeText = text.slice(at.index + at[0].length);
    const prep = at[0].trim().split(/\s+/).pop()!.toLowerCase();
    const keptPrep = text.slice(at.index).match(/\s(under(?:neath)?|behind|beside|next to|on top of|above|below|in front of|between)\s/i);
    if (keptPrep && /^(?:under|underneath|behind|beside|next|top|above|below|front|between)$/.test(prep)) {
      placeText = `${keptPrep[1]} ${placeText}`;
    }
    return { ...empty, name: capitalize(stripArticle(name)), place: splitPlace(placeText) };
  }
  return { ...empty, name: capitalize(stripArticle(text)) };
}

const QUESTION_START = new RegExp(
  '^(?:' +
    [
      "(?:do|did) you know where",
      "(?:have|has) (?:you|anyone) seen",
      "where (?:can|could|do|did|might|should|would) i (?:find|get|look for|have put|have left|put|leave|keep)",
      "where did i (?:put|leave)",
      "where(?:'s|s| is| are| was| were)",
      'can you find',
      'find',
      'look for',
      'search(?: for)?',
      'have i got',
      'do i have',
    ].join('|') +
    ')\\s+',
  'i',
);

/**
 * "where's my passport" -> "passport". Used for typed queries too, so a
 * question typed as a sentence still finds the thing.
 */
export function spokenQuery(raw: string): string {
  return stripArticle(
    clean(raw)
      .replace(FILLER, '')
      .replace(QUESTION_START, '')
      .replace(/\s+(?:go|gone|again|now|at|is|are|was|were|kept|stored)$/i, ''),
  );
}

/**
 * Lines spoken place names up with places that already exist, so "the blue
 * box" lands in House › Garage › Blue box instead of a new top-level place.
 * Returns the full path to use.
 */
export function resolveSpokenPlace(spoken: string[], locations: Location[], index: LocationIndex): string[] {
  if (spoken.length === 0) return [];
  const key = (s: string) => normalize(s.replace(ARTICLE, ''));
  const leaf = key(spoken[spoken.length - 1]!);
  const candidates = locations.filter((l) => key(l.name) === leaf);
  if (candidates.length === 0) return spoken;
  // Prefer the candidate whose ancestors mention the other spoken parts.
  const others = spoken.slice(0, -1).map(key);
  const scored = candidates
    .map((l) => {
      const ancestors = index.pathNames(l.id).slice(0, -1).map(key);
      const hits = others.filter((o) => ancestors.includes(o)).length;
      return { l, hits, misses: others.length - hits };
    })
    .sort((a, b) => b.hits - a.hits || a.misses - b.misses || b.l.lastUsedAt - a.l.lastUsedAt);
  const best = scored[0]!;
  // Spoken parts that don't exist above the match ("in the attic" for a box
  // that lives in the garage) mean the user meant somewhere new.
  if (best.misses > 0 && best.hits === 0 && others.length > 0) return spoken;
  return index.pathNames(best.l.id);
}
