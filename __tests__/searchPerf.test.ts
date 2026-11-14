import type { Item, Location } from "../src/db/types";
import { buildLocationIndex } from "../src/lib/locations";
import { buildCatalog } from "../src/search/catalog";
import { normalize } from "../src/search/fuzzy";
import { reuseItems } from "../src/state/reuse";

const WORDS =
  "drill hammer passport charger cable blue red box winter coat tent stove lamp book camera lens tripod bag sock glove scarf key spare battery torch rope".split(
    " ",
  );

function catalog(n: number) {
  const locations: Location[] = Array.from({ length: 200 }, (_, i) => ({
    id: `l${i}`,
    name: `${WORDS[i % WORDS.length]} shelf ${i}`,
    parentId: i < 20 ? null : `l${i % 20}`,
    createdAt: 0,
    lastUsedAt: i,
  })) as Location[];
  const items: Item[] = Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    name: `${WORDS[i % WORDS.length]} ${WORDS[(i * 7) % WORDS.length]} ${i}`,
    notes: i % 5 ? null : "bought at the market, keep the receipt",
    locationId: `l${i % 200}`,
    createdAt: i,
    updatedAt: i,
    tags: [WORDS[(i * 3) % WORDS.length]!],
    activeLoan: null,
    photoIds: [],
    cover: null,
  }));
  return { items, locations, index: buildLocationIndex(locations) };
}

describe("search at 5,000 things", () => {
  const { items, locations, index } = catalog(5000);

  it("answers a keystroke in under 30 ms", () => {
    const cat = buildCatalog(items, locations, index);
    for (const q of ["dri", "scrwdrvr", "blue box", "passprot"])
      cat.search(q, 80); // warm up
    const times = [
      "d",
      "dr",
      "dri",
      "dril",
      "drill",
      "wintr coat",
      "charger 42",
    ].map((q) => {
      const t = performance.now();
      cat.search(q, 80);
      return performance.now() - t;
    });
    expect(Math.max(...times)).toBeLessThan(30);
  });

  it("re-indexes after one change in under 30 ms", () => {
    buildCatalog(items, locations, index);
    const changed = items.map((it, i) =>
      i === 10 ? { ...it, name: "Renamed", updatedAt: 99999 } : it,
    );
    const t = performance.now();
    buildCatalog(reuseItems(items, changed), locations, index);
    expect(performance.now() - t).toBeLessThan(30);
  });
});

describe("folding", () => {
  it("folds letters NFD leaves alone", () => {
    expect(normalize("Łazienka")).toBe("lazienka");
    expect(normalize("Øl")).toBe("ol");
    expect(normalize("Đakovo")).toBe("dakovo");
    expect(normalize("Straße")).toBe("strasse");
    expect(normalize("Café crème")).toBe("cafe creme");
  });

  it("keeps non-Latin combining marks inside the word", () => {
    expect(normalize("किताब").split(" ")).toHaveLength(1);
    expect(normalize("किताब")).toBe("किताब");
  });
});

describe("reuseItems", () => {
  const { items } = catalog(3);
  it("keeps unchanged objects and the same array when nothing changed", () => {
    const copy = items.map((i) => ({ ...i }));
    expect(reuseItems(items, copy)).toBe(items);
    const edited = copy.map((i, n) =>
      n === 1 ? { ...i, name: "x", updatedAt: 5 } : i,
    );
    const out = reuseItems(items, edited);
    expect(out).not.toBe(items);
    expect(out[0]).toBe(items[0]);
    expect(out[1]).not.toBe(items[1]);
  });
});
