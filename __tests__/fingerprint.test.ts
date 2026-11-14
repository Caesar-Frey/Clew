import {
  addView,
  addViewDropping,
  centreSquare,
  decodeFingerprint,
  encodeFingerprint,
  labelWords,
  matchStrength,
  rankBoxes,
  visualFeatures,
  type Fingerprint,
  type FingerprintView,
} from "../src/boxes/fingerprint";

/** A w×h image: background colour with a centred box of another colour, plus some noise. */
function photo(
  bg: number[],
  box: number[],
  seed = 1,
  shift = 0,
  size = 48,
): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 30;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const inBox = x > 10 + shift && x < 38 + shift && y > 12 && y < 40;
      const c = inBox ? box : bg;
      const i = (y * size + x) * 4;
      px[i] = Math.max(0, Math.min(255, c[0]! + rand()));
      px[i + 1] = Math.max(0, Math.min(255, c[1]! + rand()));
      px[i + 2] = Math.max(0, Math.min(255, c[2]! + rand()));
      px[i + 3] = 255;
    }
  return px;
}

const view = (px: Uint8Array, lines: string[] = []): FingerprintView => ({
  ...visualFeatures(px, 48, 48),
  words: labelWords(lines),
  text: lines.join(" "),
});

const WALL = [220, 210, 190];
const BLUE = [40, 70, 160];
const RED = [170, 40, 35];
const BROWN = [150, 110, 70];

describe("box fingerprints", () => {
  const boxes: { value: string; fingerprint: Fingerprint }[] = [
    {
      value: "blue crate",
      fingerprint: addView(null, view(photo(WALL, BLUE, 1))),
    },
    {
      value: "red toolbox",
      fingerprint: addView(null, view(photo(WALL, RED, 2))),
    },
    {
      value: "camping box",
      fingerprint: addView(
        null,
        view(photo(WALL, BROWN, 3), ["CAMPING", "gear"]),
      ),
    },
    {
      value: "xmas box",
      fingerprint: addView(
        null,
        view(photo(WALL, BROWN, 4), ["Christmas", "decorations"]),
      ),
    },
  ];

  it("recognises a box by its colour from a new, slightly different photo", () => {
    const matches = rankBoxes(view(photo([200, 200, 205], BLUE, 9, 4)), boxes);
    expect(matches[0]!.value).toBe("blue crate");
    expect(matchStrength(matches)).not.toBe("weak");
  });

  it("tells two same-coloured boxes apart by their handwritten labels, even misread", () => {
    const matches = rankBoxes(
      view(photo(WALL, BROWN, 7, -3), ["Chrismas DECORATONS"]),
      boxes,
    );
    expect(matches[0]!.value).toBe("xmas box");
    expect(matches[1]!.value).not.toBe("xmas box");
    expect(matchStrength(matches)).toBe("strong");
    expect(
      rankBoxes(view(photo(WALL, BROWN, 8), ["camping"]), boxes)[0]!.value,
    ).toBe("camping box");
  });

  it("is unsure about something it has never seen", () => {
    const matches = rankBoxes(
      view(photo([30, 30, 30], [240, 200, 0], 5), ["passport"]),
      boxes,
    );
    expect(matchStrength(matches)).toBe("weak");
  });

  it("never calls a runner-up a match", () => {
    const matches = rankBoxes(
      view(photo(WALL, BROWN, 7, -3), ["Chrismas DECORATONS"]),
      boxes,
    );
    expect(
      matches.slice(1).map((_, i) => matchStrength(matches, i + 1)),
    ).not.toContain("strong");
    // A runner-up scoring high and the top barely ahead: neither is strong.
    const close = [
      { value: "a", score: 0.8, visual: 0.9, shared: 1 },
      { value: "b", score: 0.78, visual: 0.9, shared: 1 },
    ];
    expect(matchStrength(close, 0)).toBe("possible");
    expect(matchStrength(close, 1)).toBe("possible");
  });

  it("is not sure between two plain brown boxes with no writing", () => {
    const plain = [
      {
        value: "left brown",
        fingerprint: addView(null, view(photo(WALL, BROWN, 11))),
      },
      {
        value: "right brown",
        fingerprint: addView(null, view(photo(WALL, [155, 112, 72], 12))),
      },
    ];
    const matches = rankBoxes(view(photo(WALL, BROWN, 13, 2)), plain);
    expect(matchStrength(matches)).not.toBe("strong");
  });

  it('with one saved box, a different beige object is not a "match" on colour alone', () => {
    const one = [
      {
        value: "beige box",
        fingerprint: addView(null, view(photo(WALL, [200, 180, 140], 21))),
      },
    ];
    const other = rankBoxes(
      view(photo([190, 185, 170], [210, 190, 150], 22, 6)),
      one,
    );
    expect(other[0]!.visual).toBeLessThan(0.8);
    expect(matchStrength(other)).not.toBe("strong");
  });

  it("ignores generic printed carton words as evidence", () => {
    const cartons = [
      {
        value: "amazon 1",
        fingerprint: addView(
          null,
          view(photo(WALL, BROWN, 31), ["AMAZON", "FRAGILE", "THIS SIDE UP"]),
        ),
      },
      {
        value: "amazon 2",
        fingerprint: addView(
          null,
          view(photo(WALL, BROWN, 32), ["amazon", "fragile"]),
        ),
      },
    ];
    const matches = rankBoxes(
      view(photo(WALL, BROWN, 33), ["Amazon", "Fragile"]),
      cartons,
    );
    expect(matches[0]!.shared).toBe(0);
    expect(matchStrength(matches)).not.toBe("strong");
  });

  it("spreads colours across neighbouring bins so small lighting changes still match", () => {
    const a = view(photo(WALL, BLUE, 41));
    const darker = view(
      photo(
        WALL.map((c) => c * 0.9),
        BLUE.map((c) => c * 0.9),
        42,
      ),
    );
    expect(
      rankBoxes(darker, [{ value: "x", fingerprint: addView(null, a) }])[0]!
        .visual,
    ).toBeGreaterThan(0.75);
  });

  it("reports which views fall off the cap so their photos can go too", () => {
    let fp: Fingerprint | null = null;
    for (let i = 0; i < 6; i++)
      fp = addView(fp, { ...view(photo(WALL, BLUE, i)), photoId: `p${i}` });
    const { fingerprint, dropped } = addViewDropping(fp, {
      ...view(photo(WALL, BLUE, 7)),
      photoId: "p7",
    });
    expect(dropped.map((v) => v.photoId)).toEqual(["p0"]);
    expect(fingerprint.views.map((v) => v.photoId)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p7",
    ]);
  });

  it("crops to a centred square", () => {
    expect(centreSquare(400, 300)).toEqual([50, 0, 300]);
    expect(centreSquare(300, 500)).toEqual([0, 100, 300]);
  });

  it("stores compactly and keeps the most recent views", () => {
    let fp: Fingerprint | null = null;
    for (let i = 0; i < 9; i++)
      fp = addView(fp, view(photo(WALL, BLUE, i), [`view ${i}`]));
    expect(fp!.views).toHaveLength(6);
    const bytes = encodeFingerprint(fp!);
    expect(bytes.length).toBeLessThan(6 * 1200);
    expect(decodeFingerprint(bytes)).toEqual(fp);
    expect(decodeFingerprint(new TextEncoder().encode("junk"))).toBeNull();
  });
});
