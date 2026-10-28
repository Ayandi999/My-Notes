import OpenAI from "openai";

/**
 * Creates and returns an OpenAI client configured for Sarvam AI.
 */
export function getSarvamClient(options?: {
  apiKey?: string;
  baseURL?: string;
}): OpenAI {
  const apiKey =
    options?.apiKey ||
    process.env.SARVAM_API_KEY ||
    "placeholder_sarvam_api_key";

  const baseURL =
    options?.baseURL ||
    process.env.SARVAM_BASE_URL ||
    "https://api.sarvam.ai/v1";

  return new OpenAI({
    apiKey,
    baseURL,
  });
}

/**
 * Singleton / default Sarvam AI client using the OpenAI SDK.
 * Dynamically resolves environment variables when accessed.
 */
let cachedClient: OpenAI | null = null;
let cachedApiKey: string | undefined = undefined;
let cachedBaseUrl: string | undefined = undefined;

function getResolvedClient(): OpenAI {
  const apiKey = process.env.SARVAM_API_KEY || "placeholder_sarvam_api_key";
  const baseURL = process.env.SARVAM_BASE_URL || "https://api.sarvam.ai/v1";

  if (!cachedClient || cachedApiKey !== apiKey || cachedBaseUrl !== baseURL) {
    cachedApiKey = apiKey;
    cachedBaseUrl = baseURL;
    cachedClient = new OpenAI({
      apiKey,
      baseURL,
    });
  }

  return cachedClient;
}

export const sarvamClient: OpenAI = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    const instance = getResolvedClient();
    const value = Reflect.get(instance, prop, receiver);
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
});

export default sarvamClient;
