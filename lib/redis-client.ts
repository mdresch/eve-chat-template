import { Redis } from "@upstash/redis";

export type RedisClient = Redis;

export interface CreateRedisClientOptions {
  readonly url?: string;
  readonly token?: string;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly throwOnFail?: boolean;
}

const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
let redisUnavailableUntil = 0;
let cachedClient: Redis | null = null;

export function getRedisEnv() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim() ||
    process.env.eve_UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.eve_KV_REST_API_URL?.trim();

  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim() ||
    process.env.eve_UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.eve_KV_REST_API_TOKEN?.trim();

  return url && token ? { token, url } : null;
}

export async function createRedisClient(
  opts: CreateRedisClientOptions = {},
): Promise<Redis | null> {
  const env = getRedisEnv();
  const url = opts.url ?? env?.url;
  const token = opts.token ?? env?.token;

  if (!url || !token) {
    if (opts.throwOnFail ?? true) {
      throw new Error("Redis REST URL or token not configured");
    }
    return null;
  }

  // Fast path: if circuit breaker is tripped, fail open immediately
  if (Date.now() < redisUnavailableUntil) {
    if (opts.throwOnFail) {
      throw new Error("Redis circuit breaker active (cooling down)");
    }
    return null;
  }

  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 150;
  const client = new Redis({ url, token, retry: { retries: 0 } });

  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await client.ping();
      redisUnavailableUntil = 0;
      return client;
    } catch (error) {
      lastError = error;
      const delay = Math.pow(2, attempt) * baseDelayMs;
      console.warn(
        `[RedisClient] Ping failed (attempt ${attempt + 1}/${maxAttempts}): ${
          error instanceof Error ? error.message : String(error)
        } — retrying in ${delay}ms`,
      );

      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // Trip circuit breaker on repeated failure to protect request latency
  redisUnavailableUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
  cachedClient = null;
  const errorMessage = `Unable to connect to Redis after ${maxAttempts} attempts: ${
    lastError instanceof Error ? lastError.message : String(lastError)
  }`;

  if (opts.throwOnFail ?? true) {
    throw new Error(errorMessage);
  }

  console.warn(`[RedisClient] ${errorMessage}. Failing open for ${CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s.`);
  return null;
}

export async function getRedisClientSingleton(
  opts: CreateRedisClientOptions = {},
): Promise<Redis | null> {
  if (Date.now() < redisUnavailableUntil) {
    cachedClient = null;
    return null;
  }

  if (cachedClient) {
    return cachedClient;
  }

  const client = await createRedisClient(opts);
  if (client) {
    cachedClient = client;
  }
  return client;
}

export async function isRedisHealthy(
  opts: CreateRedisClientOptions = {},
): Promise<boolean> {
  try {
    const client = await getRedisClientSingleton({ ...opts, throwOnFail: false });
    if (!client) {
      return false;
    }
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

export function resetRedisClientStateForTesting() {
  cachedClient = null;
  redisUnavailableUntil = 0;
}
