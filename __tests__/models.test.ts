import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  EMBED_MODEL,
  formatSize,
  MODEL_LICENCES,
  modelFiles,
  totalBytes,
  VISION_MODELS,
} from "../src/ai/models";
import { sha256Stream } from "../src/ai/sha256";

describe("downloadable models", () => {
  const files = [...VISION_MODELS.flatMap(modelFiles)];

  it("pins every file to a commit and lists its exact size and SHA-256", () => {
    for (const f of files) {
      expect(f.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
      expect(f.url).not.toMatch(/resolve\/main/);
      expect(f.url.endsWith(`/${f.name}`)).toBe(true);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isInteger(f.bytes) && f.bytes > 1e6).toBe(true);
    }
  });

  it("only ships models whose licence allows commercial use", () => {
    const allowed = ["Apache 2.0", "MIT"];
    for (const l of MODEL_LICENCES) expect(allowed).toContain(l.licence);
    expect(JSON.stringify(VISION_MODELS)).not.toMatch(/qwen/i);
    expect(MODEL_LICENCES).toHaveLength(VISION_MODELS.length + 1);
  });

  it("shows sizes in decimal units like the phone does", () => {
    expect(formatSize(EMBED_MODEL.bytes)).toBe("146 MB");
    expect(formatSize(1_112_602_656)).toBe("1.1 GB");
    expect(totalBytes(VISION_MODELS[0]!)).toBe(
      436_808_704 + 108_785_184 + 146_146_432,
    );
  });

  it("hashes a file in chunks to the same digest as hashing it at once", async () => {
    const data = new Uint8Array(9 * 1024 * 1024 + 17).map(
      (_, i) => (i * 31) % 251,
    );
    let at = 0;
    const seen: number[] = [];
    const hex = await sha256Stream(
      async (n) => {
        const out = data.subarray(at, at + n);
        at += out.length;
        return out;
      },
      (b) => seen.push(b),
    );
    expect(hex).toBe(bytesToHex(sha256(data)));
    expect(seen.at(-1)).toBe(data.length);
    expect(seen.length).toBe(3);
  });
});
