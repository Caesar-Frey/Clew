import { buildLocationIndex, parsePathInput } from "../src/lib/locations";

describe("parsePathInput", () => {
  it("splits on > and › only", () => {
    expect(parsePathInput(" House > Garage ›  Blue   box › ")).toEqual([
      "House",
      "Garage",
      "Blue box",
    ]);
    expect(parsePathInput("Lounge > TV/Media shelf")).toEqual([
      "Lounge",
      "TV/Media shelf",
    ]);
    expect(parsePathInput("C:\\Drawer")).toEqual(["C:\\Drawer"]);
    expect(parsePathInput("   ")).toEqual([]);
  });
});

describe("buildLocationIndex", () => {
  const loc = (id: string, parentId: string | null) => ({
    id,
    name: id.toUpperCase(),
    parentId,
    notes: null,
    createdAt: 0,
    lastUsedAt: 0,
  });
  it("survives a corrupt cycle", () => {
    const index = buildLocationIndex([loc("a", "b"), loc("b", "a")]);
    expect(index.pathNames("a").length).toBeLessThanOrEqual(2);
    expect(index.isWithin("a", "zzz")).toBe(false);
  });
  it("computes subtrees", () => {
    const index = buildLocationIndex([
      loc("a", null),
      loc("b", "a"),
      loc("c", "b"),
      loc("d", null),
    ]);
    expect([...index.subtreeIds("a")].sort()).toEqual(["a", "b", "c"]);
    expect(index.pathString("c")).toBe("A › B › C");
  });
});
