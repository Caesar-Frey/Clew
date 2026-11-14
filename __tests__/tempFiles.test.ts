/** A tiny in-memory stand-in for expo-file-system. */
const mockDisk = new Set<string>();
const mockJoin = (base: string | { uri: string }, name: string) =>
  `${typeof base === "string" ? base : base.uri}/${name}`;

jest.mock("expo-file-system", () => {
  class File {
    uri: string;
    constructor(base: string | { uri: string }, name?: string) {
      this.uri = name ? mockJoin(base, name) : (base as string);
    }
    get exists() {
      return mockDisk.has(this.uri);
    }
    create() {
      mockDisk.add(this.uri);
    }
    async write() {
      if (this.uri.includes("fail-write")) throw new Error("mockDisk full");
    }
    delete() {
      mockDisk.delete(this.uri);
    }
  }
  class Directory extends File {
    create() {
      mockDisk.add(this.uri);
    }
    delete() {
      for (const p of [...mockDisk])
        if (p === this.uri || p.startsWith(`${this.uri}/`)) mockDisk.delete(p);
    }
  }
  return { File, Directory, Paths: { cache: { uri: "file:///cache" } } };
});

const mockManipulated: string[] = [];
const mockState = { failRender: false };
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: () => ({
      resize() {
        return this;
      },
      async renderAsync() {
        return {
          async saveAsync() {
            if (mockState.failRender && mockManipulated.length)
              throw new Error("boom");
            const uri = `file:///cache/ImageManipulator/${mockManipulated.length}.jpg`;
            mockManipulated.push(uri);
            mockDisk.add(uri);
            return { uri, base64: "AAAA", width: 10, height: 10 };
          },
        };
      },
    }),
  },
}));
jest.mock("expo-image-picker", () => ({}));

import { shrink } from "../src/photos/capture";
import { sweepPlaintextCaches, withTempJpeg } from "../src/photos/tempFiles";

beforeEach(() => {
  mockDisk.clear();
  mockManipulated.length = 0;
  mockState.failRender = false;
});

describe("plaintext photo files", () => {
  it("reads both sizes as base64 and leaves no manipulator files behind", async () => {
    const photo = await shrink(
      "file:///cache/ImagePicker/original.jpg",
      4000,
      3000,
    );
    expect(photo).toEqual({
      data: "AAAA",
      thumb: "AAAA",
      width: 10,
      height: 10,
    });
    expect(mockManipulated).toHaveLength(2);
    expect([...mockDisk]).toEqual([]);
  });

  it("cleans up even when processing fails half-way", async () => {
    mockState.failRender = true;
    await expect(
      shrink("file:///cache/ImagePicker/original.jpg", 4000, 3000),
    ).rejects.toThrow("boom");
    expect([...mockDisk]).toEqual([]);
  });

  it("deletes a temp JPEG after use, also on error", async () => {
    let seen = "";
    await withTempJpeg("AAAA", async (uri) => {
      seen = uri;
      expect(mockDisk.has(uri)).toBe(true);
    });
    expect(mockDisk.has(seen)).toBe(false);
    await expect(
      withTempJpeg("AAAA", async () => {
        throw new Error("ocr crashed");
      }),
    ).rejects.toThrow("ocr crashed");
    expect([...mockDisk].filter((p) => p.endsWith(".jpg"))).toEqual([]);
  });

  it("sweeps the picker, manipulator and temp folders on start", () => {
    for (const p of [
      "ImagePicker/a.jpg",
      "ImageManipulator/b.jpg",
      "clew-tmp/c.jpg",
      "models/keep.gguf",
    ])
      mockDisk.add(`file:///cache/${p}`);
    for (const d of ["ImagePicker", "ImageManipulator", "clew-tmp", "models"])
      mockDisk.add(`file:///cache/${d}`);
    sweepPlaintextCaches();
    expect([...mockDisk].sort()).toEqual([
      "file:///cache/models",
      "file:///cache/models/keep.gguf",
    ]);
  });
});
