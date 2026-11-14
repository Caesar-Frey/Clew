import type { VisionModel } from './models';
import { parseTagReply, type TagDraft } from './text';

/**
 * The browser design preview has no on-device models. This stands in for one
 * so the screens can be reviewed: a pretend download, and canned suggestions.
 */
export interface DownloadProgress {
  fraction: number;
  file: string;
  phase: 'download' | 'check';
}

let installed = false;

export const isInstalled = (_m: VisionModel) => installed;

export async function downloadModel(m: VisionModel, onProgress: (p: DownloadProgress) => void, signal?: AbortSignal) {
  for (let i = 1; i <= 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (signal?.aborted) throw new Error('Cancelled');
    onProgress({ fraction: i / 20, file: m.model.name, phase: i > 16 ? 'check' : 'download' });
  }
  installed = true;
}

export const removeModels = async () => {
  installed = false;
};
export const release = async () => {};

const CANNED: [RegExp, string, string[]][] = [
  [/stove|burner|gas/i, 'Camping stove', ['camping', 'cooking', 'outdoor', 'gas']],
  [/drill|saw|hammer|tool/i, 'Power drill', ['tools', 'diy', 'garage']],
  [/passport|document|card/i, 'Passport', ['documents', 'travel', 'important']],
];

export async function draftTags(_m: VisionModel, input: { name: string; photoUri?: string | null; existing: string[] }): Promise<TagDraft> {
  await new Promise((r) => setTimeout(r, 900));
  const hit = CANNED.find(([re]) => re.test(input.name)) ?? [null, input.name || 'Blue storage box', ['storage', 'blue', 'plastic']];
  return parseTagReply(JSON.stringify({ name: hit[1], tags: hit[2] }), input.existing);
}

export async function embed(_t: string, _k: 'query' | 'document'): Promise<Float32Array> {
  return new Float32Array();
}
