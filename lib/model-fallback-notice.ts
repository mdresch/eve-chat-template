import { Redis } from "@upstash/redis";
import type { AiProvider } from "@/lib/db/schema";

const NOTICE_TTL_SECONDS = 5 * 60;

let redis: Redis | null | undefined;

function getRedisEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim();
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim();

  return url && token ? { token, url } : null;
}

function getRedis() {
  if (redis !== undefined) {
    return redis;
  }

  const env = getRedisEnv();

  if (!env) {
    redis = null;
    return redis;
  }

  redis = new Redis(env);
  return redis;
}

function noticeKey(sessionId: string) {
  return `model-fallback:${sessionId}`;
}

export async function recordModelFallbackNotice(sessionId: string, provider: AiProvider) {
  const client = getRedis();

  if (!client) {
    return;
  }

  await client.set(noticeKey(sessionId), provider, { ex: NOTICE_TTL_SECONDS });
}

export async function consumeModelFallbackNotice(sessionId: string): Promise<AiProvider | null> {
  const client = getRedis();

  if (!client) {
    return null;
  }

  const provider = await client.get<AiProvider>(noticeKey(sessionId));

  if (provider) {
    await client.del(noticeKey(sessionId));
  }

  return provider ?? null;
}
