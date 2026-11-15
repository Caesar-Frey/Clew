import { Directory, File, Paths } from 'expo-file-system';
import { initLlama, releaseAllLlama, type LlamaContext } from 'llama.rn';

import { EMBED_MODEL, formatSize, modelFiles, type ModelFile, type VisionModel } from './models';
import { sha256Stream } from './sha256';
import { parseTagReply, TAG_SCHEMA, tagPrompt, type TagDraft } from './text';

/**
 * The optional on-device assistant. Models live in the caches folder (they
 * can be downloaded again, so they're kept out of phone backups); the OS may
 * clear them when storage runs low, and the Desk then offers to fetch them
 * again. Nothing about the catalog is ever sent anywhere: the only network
 * use is downloading model files the user asked for.
 */

const dir = () => new Directory(Paths.cache, 'models');
const fileFor = (f: ModelFile) => new File(dir(), f.name);

export function isInstalled(model: VisionModel): boolean {
  return modelFiles(model).every((f) => fileFor(f).exists);
}

export interface DownloadProgress {
  /** 0..1 over all files. */
  fraction: number;
  file: string;
  /** Downloading, or checking a finished file against its SHA-256. */
  phase: 'download' | 'check';
}

/** GGUF files start with these four bytes. */
const GGUF = [0x47, 0x47, 0x55, 0x46];

/** Keep this much free after the download so the phone stays usable. */
const HEADROOM = 500 * 1000 ** 2;

const broken = (f: ModelFile) => new Error(`${f.name} didn't download properly. Try again, on Wi-Fi if you can.`);

async function verify(file: File, expected: ModelFile, onBytes: (n: number) => void): Promise<void> {
  if ((file.size ?? 0) !== expected.bytes) throw broken(expected);
  const handle = file.open();
  try {
    const head = handle.readBytesSync(4);
    if (GGUF.some((b, i) => head[i] !== b)) throw broken(expected);
    handle.offset = 0;
    const digest = await sha256Stream((n) => handle.readBytes(n), onBytes);
    if (digest !== expected.sha256) throw broken(expected);
  } finally {
    handle.close();
  }
}

/** Bytes still to fetch for this model (files already on the phone are skipped). */
export function bytesToFetch(model: VisionModel): number {
  return modelFiles(model).reduce((n, f) => (fileFor(f).exists ? n : n + f.bytes), 0);
}

export async function downloadModel(model: VisionModel, onProgress: (p: DownloadProgress) => void, signal?: AbortSignal) {
  const d = dir();
  if (!d.exists) d.create({ intermediates: true });
  const needed = bytesToFetch(model);
  const free = Paths.availableDiskSpace;
  if (needed > 0 && typeof free === 'number' && free < needed + HEADROOM) {
    throw new Error(`Not enough space. This needs ${formatSize(needed + HEADROOM)} free; the phone has ${formatSize(free)}.`);
  }
  const files = modelFiles(model);
  // Each byte is counted twice: once downloading, once checking.
  const total = files.reduce((n, f) => n + f.bytes, 0) * 2;
  let done = 0;
  for (const f of files) {
    const target = fileFor(f);
    if (!target.exists) {
      const partial = new File(d, `${f.name}.part`);
      try {
        if (partial.exists) partial.delete();
        await File.downloadFileAsync(f.url, partial, {
          idempotent: true,
          signal,
          onProgress: ({ bytesWritten }) =>
            onProgress({ fraction: Math.min(1, (done + bytesWritten) / total), file: f.name, phase: 'download' }),
        });
        if (signal?.aborted) throw new Error('Cancelled');
        await verify(partial, f, (n) => onProgress({ fraction: Math.min(1, (done + f.bytes + n) / total), file: f.name, phase: 'check' }));
        partial.move(target);
      } catch (e) {
        // A cancelled, failed or corrupt download never leaves a partial file behind.
        if (partial.exists) partial.delete();
        throw e;
      }
    }
    done += f.bytes * 2;
    onProgress({ fraction: Math.min(1, done / total), file: f.name, phase: 'download' });
  }
}

export async function removeModels(): Promise<void> {
  await release();
  const d = dir();
  if (d.exists) d.delete();
}

/* ------------------------------------------------------------- contexts */

let vision: { id: string; ctx: Promise<LlamaContext> } | null = null;
let embedder: Promise<LlamaContext> | null = null;

function visionContext(model: VisionModel): Promise<LlamaContext> {
  if (vision?.id === model.id) return vision.ctx;
  const ctx = (async () => {
    const c = await initLlama({ model: fileFor(model.model).uri, n_ctx: 4096, n_gpu_layers: 99, use_mlock: false });
    await c.initMultimodal({ path: fileFor(model.mmproj).uri, use_gpu: true });
    return c;
  })();
  vision = { id: model.id, ctx };
  ctx.catch(() => (vision = null));
  return ctx;
}

function embedContext(): Promise<LlamaContext> {
  if (!embedder) {
    embedder = initLlama({ model: fileFor(EMBED_MODEL).uri, embedding: true, n_ctx: 512, n_gpu_layers: 99, pooling_type: 'mean' });
    embedder.catch(() => (embedder = null));
  }
  return embedder;
}

/** Frees the models' memory (e.g. when the app goes to the background). */
export async function release(): Promise<void> {
  vision = null;
  embedder = null;
  await releaseAllLlama().catch(() => {});
}

/**
 * Suggests a name and subjects for a thing, from its photo and/or name. The
 * user picks which to keep.
 */
export async function draftTags(
  model: VisionModel,
  input: { name: string; notes?: string | null; photoUri?: string | null; knownTags: string[]; existing: string[] },
): Promise<TagDraft> {
  const ctx = await visionContext(model);
  const text = tagPrompt({ name: input.name, notes: input.notes, hasPhoto: !!input.photoUri, knownTags: input.knownTags });
  const result = await ctx.completion({
    messages: [
      { role: 'system', content: 'You help catalogue household belongings. Answer only with JSON.' },
      {
        role: 'user',
        content: input.photoUri
          ? [
              { type: 'image_url', image_url: { url: input.photoUri } },
              { type: 'text', text },
            ]
          : text,
      },
    ],
    response_format: { type: 'json_schema', json_schema: { strict: true, schema: TAG_SCHEMA } },
    n_predict: 160,
    temperature: 0.2,
  });
  return parseTagReply(result.text, input.existing);
}

export async function embed(text: string, kind: 'query' | 'document'): Promise<Float32Array> {
  const ctx = await embedContext();
  const prefix = kind === 'query' ? EMBED_MODEL.queryPrefix : EMBED_MODEL.docPrefix;
  const { embedding } = await ctx.embedding(prefix + text);
  return Float32Array.from(embedding);
}
