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

/** "uncle bob" -> "Uncle Bob"; "sam and priya" -> "Sam and Priya" (one borrower string). */
function properName(s: string): string {
  return stripArticle(s)
    .split(' ')
    .map((w) => (/^(?:and|&)$/i.test(w) ? w.toLowerCase() : capitalize(w)))
    .join(' ');
}

/** A pronoun is not a name: "I lent it to Sam" leaves the name for the user. */
const PRONOUN = /^(?:it|this|that|them|these|those|one)$/i;
const thingName = (s: string) => {
  const n = stripArticle(s);
  return PRONOUN.test(n) ? '' : capitalize(n);
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from `now` to the given local date (DST-safe). */
function daysUntil(now: Date, y: number, m: number, d: number): number {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Math.round((new Date(y, m, d, 12).getTime() - from.getTime()) / DAY_MS);
}

/** Days from `now` to a spoken point in time ("Friday", "next week", "the end of the month"). */
function calendarDays(phrase: string, now: Date): number | null {
  const p = phrase.toLowerCase().replace(/^the\s+/, '');
  const dow = now.getDay();
  if (p === 'tomorrow') return 1;
  const weekday = p.match(/^(?:(this|next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2]!);
    let d = (target - dow + 7) % 7 || 7;
    // "next Friday" is the Friday of next week; weeks start on Monday.
    const mon = (x: number) => (x + 6) % 7;
    if (weekday[1] === 'next' && mon(target) > mon(dow)) d += 7;
    return d;
  }
  if (/^(?:this\s+)?weekend$/.test(p) || p === 'end of the week' || p === 'end of this week') return (6 - dow + 7) % 7 || 7;
  if (p === 'next weekend') return ((6 - dow + 7) % 7 || 7) + 7;
  if (p === 'next week') return (1 - dow + 7) % 7 || 7;
  if (p === 'next month') {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const last = new Date(y, m + 1, 0).getDate();
    return daysUntil(now, y, m, Math.min(now.getDate(), last));
  }
  if (p === 'end of the month' || p === 'end of this month') {
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (now.getDate() < last) return daysUntil(now, now.getFullYear(), now.getMonth(), last);
    return daysUntil(now, now.getFullYear(), now.getMonth() + 2, 0);
  }
  return null;
}

const SPAN = '(?:(?:about|around)\\s+)?(?:a\\s+)?(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)\\s+(?:of\\s+)?(day|week|month)s?';
const POINT =
  '((?:the\\s+)?(?:end of (?:the|this) (?:week|month)|(?:this\\s+|next\\s+)?weekend)|tomorrow|next week|next month|(?:(?:this|next)\\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))';
const DUE = new RegExp(`\\s+(?:for|until|till|til|by|due|back in|back by|back on|due in|on)\\s+(?:${SPAN}|${POINT})\\s*$`, 'i');
const BARE_SPAN = new RegExp(`\\s+(?:for\\s+)?${SPAN}\\s*$`, 'i');

/** "for two weeks", "until Friday", "for a couple of weeks", "till the end of the month" */
function parseDue(text: string, now: Date): { rest: string; days: number | null } {
  const m = text.match(DUE) ?? text.match(BARE_SPAN);
  if (!m || m.index === undefined) return { rest: text, days: null };
  let days: number | null;
  if (m[3]) {
    days = calendarDays(m[3], now);
  } else {
    const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : (NUMBERS[m[1]!.toLowerCase()] ?? 1);
    const unit = m[2]!.toLowerCase();
    days = n * (unit === 'week' ? 7 : unit === 'month' ? 30 : 1);
  }
  if (days === null) return { rest: text, days: null };
  return { rest: text.slice(0, m.index), days: Math.min(days, 365) };
}

/** "the blue box in the garage" -> ["Garage", "Blue box"] */
export function splitPlace(text: string): string[] {
  const parts: string[] = [];
  // "on the left/right/top/bottom" describes a place, it isn't another one:
  // hide it from the splitting below, then put it back.
  let rest = clean(text).replace(/\s+on\s+the\s+(left|right|top|bottom)((?:\s+(?:side|shelf|hand side))?)(?=\s|$)/gi, '\u0001$1$2');
  // Spoken outermost-last: "blue box in the garage" -> ["Garage", "Blue box"].
  // A typed or spoken path ("garage greater than blue box") wins.
  if (/[>›/]|\bgreater than\b/i.test(rest)) {
    return rest
      .split(/\s*(?:[>›/]|\bgreater than\b)\s*/i)
      .map((p) => capitalize(stripArticle(p)).replace(/\u0001/g, ' on the '))
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
      return capitalize(kept ? `${kept[1]!.toLowerCase()} the ${body}` : body).replace(/\u0001/g, ' on the ');
    })
    .filter(Boolean);
}

export function parseSpokenCard(raw: string, now: number = Date.now()): SpokenCard {
  let text = clean(raw).replace(FILLER, '');
  const empty = { place: [] as string[], person: null, dueInDays: null };

  // Lending.
  const due = parseDue(text, new Date(now));
  const lent = due.rest.match(/^(?:i(?:'ve| have)?\s+)?(?:lent|loaned|gave|given|lend|loan)\s+(.+?)\s+to\s+(.+)$/i);
  if (lent && lent[1] && lent[2]) {
    return { name: thingName(lent[1]), place: [], person: properName(lent[2]), dueInDays: due.days };
  }
  // "I lent Sam the drill": a name, then the thing with its article.
  const lentWho = due.rest.match(/^(?:i(?:'ve| have)?\s+)?(?:lent|loaned|gave|given|lend|loan)\s+([a-z][\w'-]*)\s+((?:the|my|our|a|an|his|her|their|some)\s+.+)$/i);
  if (lentWho && lentWho[1] && lentWho[2] && !PRONOUN.test(lentWho[1]) && !ARTICLE.test(`${lentWho[1]} `)) {
    return { name: thingName(lentWho[2]), place: [], person: properName(lentWho[1]), dueInDays: due.days };
  }
  // "the drill is with Sam" (but "the passport is with the documents" is a place).
  const withWho = due.rest.match(/^(.+?)\s+(?:is|are|'s)\s+with\s+(.+)$/i);
  if (withWho && withWho[1] && withWho[2] && !ARTICLE.test(withWho[2])) {
    return { name: thingName(withWho[1]), place: [], person: properName(withWho[2]), dueInDays: due.days };
  }
  const has = due.rest.match(/^(.+?)\s+(?:has|borrowed|took|is borrowing|has got)\s+(.+)$/i);
  if (has && has[1] && has[2] && !PRONOUN.test(stripArticle(has[1]))) {
    return { name: thingName(has[2]), place: [], person: properName(has[1]), dueInDays: due.days };
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
    return { ...empty, name: thingName(name), place: splitPlace(placeText) };
  }
  return { ...empty, name: thingName(text) };
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
