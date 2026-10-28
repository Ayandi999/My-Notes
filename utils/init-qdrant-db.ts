import { QdrantClient } from "@qdrant/js-client-rest";

export interface InitQdrantDbOptions {
  /**
   * The name of the collection to check or create.
   * Defaults to process.env.QDRANT_COLLECTION_NAME or "memory".
   */
  collectionName?: string;

  /**
   * Vector dimension size. Defaults to 1536 for OpenAI embeddings
   * (e.g., text-embedding-3-small, text-embedding-ada-002).
   */
  vectorSize?: number;

  /**
   * Distance metric for vector search. Defaults to "Cosine" (standard for OpenAI).
   */
  distance?: "Cosine" | "Euclid" | "Dot" | "Manhattan";

  /**
   * Qdrant server URL. Defaults to process.env.QDRANT_URL or "http://localhost:6333".
   */
  url?: string;

  /**
   * Qdrant API key if authentication is required. Defaults to process.env.QDRANT_API_KEY.
   */
  apiKey?: string;

  /**
   * An existing QdrantClient instance to reuse.
   */
  client?: QdrantClient;
}

export type CheckQdrantDbOptions = Pick<
  InitQdrantDbOptions,
  "collectionName" | "url" | "apiKey" | "client"
>;

export interface InitQdrantDbResult {
  client: QdrantClient;
  collectionName: string;
  alreadyExisted: boolean;
}

export type InitQdrantDbResponse = QdrantClient & InitQdrantDbResult;

/**
 * Creates and returns a configured QdrantClient instance.
 */
export function getQdrantClient(options?: {
  url?: string;
  apiKey?: string;
}): QdrantClient {
  const url = options?.url || process.env.QDRANT_URL || "http://localhost:6333";
  const rawApiKey = options?.apiKey ?? process.env.QDRANT_API_KEY;
  const apiKey = rawApiKey && rawApiKey.trim().length > 0 ? rawApiKey.trim() : undefined;

  return new QdrantClient({
    url,
    apiKey,
  });
}

/**
 * Checks if a Qdrant collection/db already exists.
 *
 * @param collectionNameOrOptions Name of the collection or configuration options
 * @returns boolean indicating whether the collection exists
 */
export async function checkQdrantDbExists(
  collectionNameOrOptions?: string | CheckQdrantDbOptions
): Promise<boolean> {
  const options =
    typeof collectionNameOrOptions === "string"
      ? { collectionName: collectionNameOrOptions }
      : collectionNameOrOptions;

  const collectionName =
    options?.collectionName ||
    process.env.QDRANT_COLLECTION_NAME ||
    "memory";

  const client =
    options?.client ??
    getQdrantClient({
      url: options?.url,
      apiKey: options?.apiKey,
    });

  const { exists } = await client.collectionExists(collectionName);
  return Boolean(exists);
}

/**
 * Initializes Qdrant database:
 * 1. Checks if the collection (default "memory") exists.
 * 2. If it does not exist, creates the collection configured for OpenAI embeddings
 *    (size: 1536, distance: "Cosine").
 *
 * @param options Optional configuration overrides
 * @returns The QdrantClient instance decorated with collectionName and alreadyExisted flag
 */
export async function initQdrantDb(
  options?: InitQdrantDbOptions
): Promise<InitQdrantDbResponse> {
  const collectionName =
    options?.collectionName ||
    process.env.QDRANT_COLLECTION_NAME ||
    "memory";

  const vectorSize = options?.vectorSize ?? 1536;
  const distance = options?.distance ?? "Cosine";

  const client =
    options?.client ??
    getQdrantClient({
      url: options?.url,
      apiKey: options?.apiKey,
    });

  // Check if the collection / database already exists
  const exists = await checkQdrantDbExists({
    collectionName,
    client,
  });

  if (!exists) {
    // Create the collection configured for OpenAI embeddings
    await client.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: distance,
      },
    });
  }

  const result = Object.assign(client, {
    client,
    collectionName,
    alreadyExisted: exists,
  });

  return result as InitQdrantDbResponse;
}

export { initQdrantDb as initQdrantMemory };
export default initQdrantDb;
