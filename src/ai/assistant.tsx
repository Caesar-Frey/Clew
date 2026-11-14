import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { withTempJpeg } from '../photos/tempFiles';
import { useData } from '../state/data';
import { downloadModel, draftTags, embed, isInstalled, release, removeModels, type DownloadProgress } from './engine';
import { EMBED_MODEL, VISION_MODELS, type VisionModel } from './models';
import { fromBytes, itemText, nearest, toBytes, type TagDraft } from './text';

/** Which model is installed on this phone. Device-only: model files aren't in backups. */
export const ASSISTANT_KEY = 'device.assistantModel';

type Status =
  | { state: 'off' }
  | { state: 'downloading'; model: VisionModel; progress: DownloadProgress | null }
  | { state: 'ready'; model: VisionModel }
  | { state: 'missing'; model: VisionModel }
  | { state: 'failed'; model: VisionModel; error: string };

interface AssistantValue {
  status: Status;
  download: (modelId: string) => void;
  cancel: () => void;
  remove: () => Promise<void>;
  /** Suggests a name and subjects. Photo is base64 JPEG (stored photos) or a file uri. */
  suggest: (input: { name: string; notes?: string | null; photo?: { base64?: string; uri?: string } | null; existing: string[] }) => Promise<TagDraft>;
  /** Item ids closest in meaning to `query`. Empty when the assistant is off. */
  searchByMeaning: (query: string) => Promise<{ id: string; score: number }[]>;
}

const AssistantContext = createContext<AssistantValue | null>(null);

export function useAssistant() {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error('useAssistant outside AssistantProvider');
  return ctx;
}

/** Above this cosine similarity, a result is worth showing as "might be". */
const MEANING_THRESHOLD = 0.62;

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { settings, actions, items, index } = useData();
  const installedId = settings[ASSISTANT_KEY] ?? null;
  const installedModel = VISION_MODELS.find((m) => m.id === installedId) ?? null;
  const [transient, setTransient] = useState<Status | null>(null);
  const abort = useRef<AbortController | null>(null);
  const vectors = useRef(new Map<string, Float32Array>());

  const status: Status = useMemo(() => {
    if (transient) return transient;
    if (!installedModel) return { state: 'off' };
    return isInstalled(installedModel) ? { state: 'ready', model: installedModel } : { state: 'missing', model: installedModel };
  }, [transient, installedModel]);
  const ready = status.state === 'ready';

  const download = useCallback(
    (modelId: string) => {
      const model = VISION_MODELS.find((m) => m.id === modelId);
      if (!model) return;
      const controller = new AbortController();
      abort.current = controller;
      setTransient({ state: 'downloading', model, progress: null });
      downloadModel(model, (progress) => setTransient({ state: 'downloading', model, progress }), controller.signal)
        .then(async () => {
          await actions.setSetting(ASSISTANT_KEY, model.id);
          setTransient(null);
        })
        .catch((e: unknown) => {
          setTransient(
            controller.signal.aborted ? null : { state: 'failed', model, error: e instanceof Error ? e.message : String(e) },
          );
        });
    },
    [actions],
  );

  const cancel = useCallback(() => {
    abort.current?.abort();
    setTransient(null);
  }, []);

  const remove = useCallback(async () => {
    abort.current?.abort();
    await removeModels();
    await actions.setSetting(ASSISTANT_KEY, '');
    vectors.current.clear();
    setTransient(null);
  }, [actions]);

  // Free model memory whenever the app leaves the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'background' && release());
    return () => sub.remove();
  }, []);

  // Keep embeddings current in the background, a few items at a time.
  useEffect(() => {
    if (!ready) return;
    let live = true;
    (async () => {
      for (const row of await actions.listEmbeddings(EMBED_MODEL.id)) vectors.current.set(row.id, fromBytes(row.embedding));
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const id of await actions.staleEmbeddings(EMBED_MODEL.id, 200)) {
        if (!live) return;
        const item = byId.get(id);
        if (!item) continue;
        const v = await embed(itemText(item, index), 'document');
        if (!live || v.length === 0) return;
        vectors.current.set(id, v);
        await actions.setEmbedding(id, toBytes(v), EMBED_MODEL.id);
      }
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [ready, items, index, actions]);

  const suggest = useCallback<AssistantValue['suggest']>(
    async (input) => {
      if (status.state !== 'ready') return { name: null, tags: [] };
      const knownTags = [...new Set(items.flatMap((i) => i.tags))];
      const run = (photoUri: string | null) => draftTags(status.model, { ...input, photoUri, knownTags, existing: input.existing });
      if (input.photo?.uri) return run(input.photo.uri);
      // llama.cpp reads images from a file; this one is deleted right after.
      if (input.photo?.base64) return withTempJpeg(input.photo.base64, run);
      return run(null);
    },
    [status, items],
  );

  const searchByMeaning = useCallback(
    async (query: string) => {
      if (!ready || !query.trim() || vectors.current.size === 0) return [];
      const q = await embed(query.trim(), 'query');
      return nearest(q, vectors.current, MEANING_THRESHOLD);
    },
    [ready],
  );

  const value = useMemo(() => ({ status, download, cancel, remove, suggest, searchByMeaning }), [status, download, cancel, remove, suggest, searchByMeaning]);
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

/** Wait this long after typing stops before asking the embedder. */
const MEANING_DEBOUNCE_MS = 350;

/**
 * Items whose meaning is close to `query`, for "might be what you mean".
 * Empty while typing, when the query is short, or when the assistant is off.
 */
export function useMeaningSearch(query: string, limit = 6): { id: string; score: number }[] {
  const { status, searchByMeaning } = useAssistant();
  const [result, setResult] = useState<{ query: string; hits: { id: string; score: number }[] }>({ query: '', hits: [] });
  const q = query.trim();
  const active = status.state === 'ready' && q.length >= 3;

  useEffect(() => {
    if (!active) return;
    let live = true;
    const t = setTimeout(() => {
      searchByMeaning(q)
        .then((hits) => live && setResult({ query: q, hits: hits.slice(0, limit) }))
        .catch(() => {});
    }, MEANING_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [active, q, limit, searchByMeaning]);

  return active && result.query === q ? result.hits : [];
}
