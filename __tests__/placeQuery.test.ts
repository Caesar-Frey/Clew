import { saveLabel, shortPath } from "../src/lib/placeQuery";
import type { Location } from "../src/db/types";
import { buildLocationIndex } from "../src/lib/locations";
import {
  findPath,
  placeLabel,
  placeOptions,
  placeSearchIndex,
} from "../src/lib/placeQuery";

let t = 0;
const loc = (
  id: string,
  name: string,
  parentId: string | null = null,
): Location => ({
  id,
  name,
  parentId,
  notes: null,
  createdAt: 0,
  lastUsedAt: ++t,
});

const locations = [
  loc("house", "House"),
  loc("garage", "Garage", "house"),
  loc("box", "Blue box", "garage"),
  loc("shelf", "Tool shelf", "garage"),
  loc("lounge", "Lounge", "house"),
  loc("tin", "Blue tin", "lounge"),
  loc("tv", "TV/Media shelf", "lounge"),
];
const index = buildLocationIndex(locations);
const search = placeSearchIndex(locations, index);
const options = (q: string, contextId?: string) =>
  placeOptions(q, locations, index, search, { contextId });

describe("place field options", () => {
  it("matches a nested place by its leaf name instead of creating a top-level duplicate", () => {
    const o = options("Blue box");
    expect(o[0]).toEqual({
      kind: "existing",
      id: "box",
      path: "House › Garage › Blue box",
    });
    expect(o.some((x) => x.kind === "new")).toBe(false);
  });

  it('highlights the best partial match first, so Return never makes a place called "Gar"', () => {
    const o = options("gar");
    expect(o[0]).toMatchObject({ kind: "existing", id: "garage" });
    const create = o.at(-1)!;
    expect(create).toMatchObject({
      kind: "new",
      parentId: null,
      names: ["gar"],
    });
  });

  it('lists fuzzy matches by leaf and path, with "Create new place" last', () => {
    const o = options("blue");
    expect(
      o.slice(0, 2).map((x) => (x.kind === "existing" ? x.id : null)),
    ).toEqual(expect.arrayContaining(["box", "tin"]));
    expect(o.at(-1)).toMatchObject({ kind: "new", names: ["blue"] });
  });

  it("still understands typed paths, starting from any uniquely named place", () => {
    expect(options("Garage > Tool shelf")[0]).toMatchObject({
      kind: "existing",
      id: "shelf",
    });
    expect(options("Garage > Red crate").at(-1)).toMatchObject({
      kind: "new",
      parentId: "garage",
      names: ["Red crate"],
    });
  });

  it("offers inside the current place or at the top level for a brand new name", () => {
    const o = options("Crate", "garage").filter((x) => x.kind === "new");
    expect(o).toEqual([
      {
        kind: "new",
        parentId: "garage",
        names: ["Crate"],
        label: "inside Garage",
      },
      {
        kind: "new",
        parentId: null,
        names: ["Crate"],
        label: "at the top level",
      },
    ]);
  });

  it("keeps slashes in names", () => {
    expect(options("TV/Media")[0]).toMatchObject({
      kind: "existing",
      id: "tv",
    });
  });

  it('returns nothing for an empty path like ">"', () => {
    expect(options(">")).toEqual([]);
    expect(options("  ")).toEqual([]);
  });

  it("finds and labels paths", () => {
    expect(findPath("house > GARAGE > blue box", index)).toBe("box");
    expect(findPath("Blue box", index, "garage")).toBe("box");
    expect(findPath("Garage", index)).toBeNull();
    expect(
      placeLabel({ kind: "new", parentId: "garage", names: ["Crate"] }, index),
    ).toBe("House › Garage › Crate");
  });
});

describe("save button label", () => {
  it("states the outcome", () => {
    expect(
      saveLabel({
        lent: false,
        person: "",
        place: "House › Garage › Blue box",
      }),
    ).toBe("Save to Garage › Blue box");
    expect(saveLabel({ lent: false, person: "", place: "" })).toBe(
      "Save without a place",
    );
    expect(saveLabel({ lent: true, person: " Sam ", place: "Garage" })).toBe(
      "Lend to Sam",
    );
    expect(saveLabel({ lent: true, person: "", place: "" })).toBe(
      "Lend to someone",
    );
    expect(shortPath("Garage")).toBe("Garage");
  });
});
