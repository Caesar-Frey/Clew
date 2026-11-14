import type { Item, Location } from "../db/types";
import type { LocationIndex } from "../lib/locations";
import { fingerprintText, type Fingerprint } from "../boxes/fingerprint";
import {
  createSearchIndex,
  prepareFields,
  vocabGeneration,
  type PreparedField,
  type SearchIndex,
} from "./fuzzy";

/** Prepared search fields per item object, valid while its place path is unchanged. */
const itemFields = new WeakMap<
  Item,
  { path: string; gen: number; fields: PreparedField[] }
>();

function fieldsFor(item: Item, path: string): PreparedField[] {
  const hit = itemFields.get(item);
  if (hit && hit.path === path && hit.gen === vocabGeneration())
    return hit.fields;
  const fields = prepareFields([
    { text: item.name, weight: 1 },
    { text: item.tags.join(" "), weight: 0.85 },
    { text: path, weight: 0.6 },
    { text: item.activeLoan?.person ?? "", weight: 0.7 },
    { text: item.notes ?? "", weight: 0.4 },
  ]);
  itemFields.set(item, { path, gen: vocabGeneration(), fields });
  return fields;
}

export type CatalogHit =
  | { kind: "item"; item: Item }
  | { kind: "place"; place: Location };

/**
 * One index over things and places. Things match on their name first, then
 * tags, the place they're in, who has them, and notes.
 */
export function buildCatalog(
  items: Item[],
  locations: Location[],
  index: LocationIndex,
  /** Box fingerprints, so words on a handwritten label find the box. */
  boxes?: Map<string, { fp: Fingerprint | null }>,
): SearchIndex<CatalogHit> {
  const gen = vocabGeneration();
  const built = build(items, locations, index, boxes);
  // The shared vocabulary was reset part-way: build again in one id space.
  return gen === vocabGeneration()
    ? built
    : build(items, locations, index, boxes);
}

function build(
  items: Item[],
  locations: Location[],
  index: LocationIndex,
  boxes?: Map<string, { fp: Fingerprint | null }>,
): SearchIndex<CatalogHit> {
  return createSearchIndex<CatalogHit>([
    ...items.map((item) => ({
      value: { kind: "item" as const, item },
      rank: item.updatedAt,
      prepared: fieldsFor(item, index.pathString(item.locationId)),
    })),
    ...locations.map((place) => ({
      value: { kind: "place" as const, place },
      rank: place.lastUsedAt,
      fields: [
        { text: place.name, weight: 0.95 },
        {
          text: index.pathNames(place.parentId ?? null).join(" "),
          weight: 0.3,
        },
        {
          text: fingerprintText(boxes?.get(place.id)?.fp ?? null),
          weight: 0.7,
        },
      ],
    })),
  ]);
}
