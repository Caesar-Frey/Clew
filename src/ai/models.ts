/**
 * Open-weight models the optional library assistant can download. They run
 * entirely on the phone through llama.cpp (llama.rn). Every file is pinned to
 * a fixed repository revision and checked against its SHA-256 after download,
 * so what runs on the phone is exactly the file listed here.
 *
 * Only models under licences that allow commercial use may be listed here.
 */
export interface ModelFile {
  /** File name on disk. */
  name: string;
  url: string;
  /** Exact size in bytes. */
  bytes: number;
  /** Lower-case hex SHA-256 of the file. */
  sha256: string;
}

export interface ModelLicence {
  /** Display name of the model. */
  name: string;
  licence: string;
  /** Where the licence and model card can be read. */
  source: string;
}

export interface VisionModel {
  id: string;
  title: string;
  blurb: string;
  model: ModelFile;
  /** The vision projector that lets the model see photos. */
  mmproj: ModelFile;
  /** Phones with less memory than this are not offered the model. */
  minRamBytes: number;
  licence: ModelLicence;
}

const HF = 'https://huggingface.co';
const GB = 1000 ** 3;

/** A file pinned to one commit of a Hugging Face repository. */
const hf = (repo: string, revision: string, name: string, bytes: number, sha256: string): ModelFile => ({
  name,
  url: `${HF}/${repo}/resolve/${revision}/${name}`,
  bytes,
  sha256,
});

const SMOL_500M = 'ggml-org/SmolVLM2-500M-Video-Instruct-GGUF';
const SMOL_500M_REV = 'ccd7aae53bcb1997355c2f094959e72b3642ce17';
const SMOL_2B = 'ggml-org/SmolVLM2-2.2B-Instruct-GGUF';
const SMOL_2B_REV = '1bc3c9f74ceafd4c8d4411cc9cf188bba3798f91';
const NOMIC = 'nomic-ai/nomic-embed-text-v1.5-GGUF';
const NOMIC_REV = '0188c9bf409793f810680a5a431e7b899c46104c';

export const VISION_MODELS: VisionModel[] = [
  {
    id: 'smolvlm2-500m',
    title: 'Compact',
    blurb: 'SmolVLM2 500M. Quick, and fine for naming and tagging everyday things.',
    model: hf(SMOL_500M, SMOL_500M_REV, 'SmolVLM2-500M-Video-Instruct-Q8_0.gguf', 436_808_704, '6f67b8036b2469fcd71728702720c6b51aebd759b78137a8120733b4d66438bc'),
    mmproj: hf(SMOL_500M, SMOL_500M_REV, 'mmproj-SmolVLM2-500M-Video-Instruct-Q8_0.gguf', 108_785_184, '921dc7e259f308e5b027111fa185efcbf33db13f6e35749ddf7f5cdb60ef520b'),
    minRamBytes: 3 * GB,
    licence: { name: 'SmolVLM2 500M Video Instruct', licence: 'Apache 2.0', source: `${HF}/${SMOL_500M}` },
  },
  {
    id: 'smolvlm2-2.2b',
    title: 'Thorough',
    blurb: 'SmolVLM2 2.2B. Better at reading labels and odd objects. Needs a recent phone.',
    model: hf(SMOL_2B, SMOL_2B_REV, 'SmolVLM2-2.2B-Instruct-Q4_K_M.gguf', 1_112_602_656, '0cf76814555b8665149075b74ab6b5c1d428ea1d3d01c1918c12012e8d7c9f58'),
    mmproj: hf(SMOL_2B, SMOL_2B_REV, 'mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf', 592_523_200, 'ae07ea1facd07dd3230c4483b63e8cda96c6944ad2481f33d531f79e892dd024'),
    minRamBytes: 6 * GB,
    licence: { name: 'SmolVLM2 2.2B Instruct', licence: 'Apache 2.0', source: `${HF}/${SMOL_2B}` },
  },
];

/** Text embeddings for "search by description". Small and always paired with the vision model. */
export const EMBED_MODEL: ModelFile & { id: string; queryPrefix: string; docPrefix: string; licence: ModelLicence } = {
  id: 'nomic-embed-v1.5',
  ...hf(NOMIC, NOMIC_REV, 'nomic-embed-text-v1.5.Q8_0.gguf', 146_146_432, '3e24342164b3d94991ba9692fdc0dd08e3fd7362e0aacc396a9a5c54a544c3b7'),
  // nomic-embed expects task prefixes.
  queryPrefix: 'search_query: ',
  docPrefix: 'search_document: ',
  licence: { name: 'Nomic Embed Text v1.5', licence: 'Apache 2.0', source: `${HF}/${NOMIC}` },
};

/** Every model the app can download, for the licences list on the Desk. */
export const MODEL_LICENCES: ModelLicence[] = [...VISION_MODELS.map((m) => m.licence), EMBED_MODEL.licence];

export function modelFiles(m: VisionModel): ModelFile[] {
  return [m.model, m.mmproj, EMBED_MODEL];
}

export function totalBytes(m: VisionModel): number {
  return modelFiles(m).reduce((n, f) => n + f.bytes, 0);
}

/** Decimal units, matching what phones show in their storage settings. */
export function formatSize(bytes: number): string {
  return bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / 1000 ** 2)} MB`;
}

/**
 * Models this phone has the memory for. Phones report a little less than
 * their nominal RAM (a "6 GB" phone says about 5.5 GB), hence the slack.
 * Unknown memory (null) offers every model.
 */
export function modelsForMemory(models: readonly VisionModel[], totalMemory: number | null): VisionModel[] {
  if (!totalMemory) return [...models];
  return models.filter((m) => totalMemory >= m.minRamBytes * 0.85);
}
