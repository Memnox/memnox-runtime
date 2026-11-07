import {
  DEFAULT_EMBEDDING_URL,
  isLoopbackUrl,
  loadOrCreateConfig,
  type EmbeddingPort,
} from '@memnox/core';

/**
 * Memory's words embedded by a model on this machine, through Ollama's `/api/embed`, and only once
 * the person named a model in the config. Any address off this machine is refused before a request.
 */

const EMBED_PATH = '/api/embed';

/** A model being loaded the first time is slow, but a search is a person waiting. */
const EMBED_TIMEOUT_MS = 20_000;

/** Enough for a batch of vectors from any model, so a broken server cannot fill the daemon's memory. */
const MOST_RESPONSE_CHARACTERS = 64 * 1024 * 1024;

interface OllamaSettings {
  model: string;
  url: string;
  /** Injected so a test answers without a server. */
  fetch?: typeof fetch;
}

/** Null where the address is not this machine's, so nothing is ever sent elsewhere. */
export function ollamaEmbedder(settings: OllamaSettings): EmbeddingPort | null {
  if (!isLoopbackUrl(settings.url)) return null;
  const endpoint = new URL(EMBED_PATH, settings.url).toString();
  const fetcher = settings.fetch ?? fetch;
  return {
    model: settings.model,
    embed: async (texts) => {
      if (texts.length === 0) return [];
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: settings.model, input: texts }),
        redirect: 'error',
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`it answered ${response.status}`);
      // Refused before it is read where the server says its size, and after where it does not.
      if (Number(response.headers.get('content-length') ?? 0) > MOST_RESPONSE_CHARACTERS)
        throw new Error('its answer was too large');
      const text = await response.text();
      if (text.length > MOST_RESPONSE_CHARACTERS)
        throw new Error('its answer was too large');
      return vectorsOf(text, texts.length);
    },
  };
}

/** The `embeddings` field, one array of numbers per text, or a throw naming what was wrong. */
function vectorsOf(text: string, expected: number): number[][] {
  // Parsed loosely and checked below, since the shape is somebody else's.
  const parsed = JSON.parse(text) as { embeddings?: unknown };
  const embeddings = parsed.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== expected)
    throw new Error('it returned no embeddings for the texts');
  return embeddings.map((vector: unknown) => {
    if (!Array.isArray(vector) || !vector.every((each) => typeof each === 'number'))
      throw new Error('it returned an embedding that is not numbers');
    // Cast is safe: every element was checked to be a number just above.
    return vector as number[];
  });
}

/** The embedder the person turned on in the config, or null while it is off. */
export async function embedderFor(home: string): Promise<EmbeddingPort | null> {
  // A config that cannot be read turns nothing on, so search stays keyword only.
  const config = await loadOrCreateConfig(home).catch(() => null);
  const model = config === null ? undefined : config.embeddingModel;
  if (model === undefined) return null;
  return ollamaEmbedder({ model, url: config?.embeddingUrl ?? DEFAULT_EMBEDDING_URL });
}
