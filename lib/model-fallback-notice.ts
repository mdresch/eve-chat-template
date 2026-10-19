import { getRedisClientSingleton } from "@/lib/redis-client";
import type { AiProvider } from "@/lib/db/schema";

const NOTICE_TTL_SECONDS = 5 * 60;

function noticeKey(sessionId: string) {
  return `model-fallback:${sessionId}`;
}

export async function recordModelFallbackNotice(sessionId: string, provider: AiProvider) {
  const client = await getRedisClientSingleton({ throwOnFail: false });

  if (!client) {
    return;
  }

  try {
    await client.set(noticeKey(sessionId), provider, { ex: NOTICE_TTL_SECONDS });
  } catch (error) {
    console.warn(
      "[ModelFallbackNotice] Redis unavailable:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function consumeModelFallbackNotice(sessionId: string): Promise<AiProvider | null> {
  const client = await getRedisClientSingleton({ throwOnFail: false });

  if (!client) {
    return null;
  }

  try {
    const provider = await client.get<AiProvider>(noticeKey(sessionId));

    if (provider) {
      await client.del(noticeKey(sessionId));
    }

    return provider ?? null;
  } catch (error) {
    console.warn(
      "[ModelFallbackNotice] Redis unavailable:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
