import * as Sentry from "@sentry/nextjs";
import { getRedisClientSingleton } from "@/lib/redis-client";

type LimitOptions = {
  readonly key: string;
  readonly limit: number;
  readonly prefix: string;
  readonly windowSeconds: number;
};

export class RateLimitError extends Error {
  readonly retryAfter: number;

  constructor(retryAfter: number) {
    super("Too many requests. Please wait a moment and try again.");
    this.retryAfter = retryAfter;
  }
}

export async function enforceRateLimit(options: LimitOptions) {
  const client = await getRedisClientSingleton({ throwOnFail: false });

  if (!client) {
    return;
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const windowId = Math.floor(now / options.windowSeconds);
    const redisKey = `rate:${options.prefix}:${options.key}:${windowId}`;
    const count = await client.incr(redisKey);

    if (count === 1) {
      await client.expire(redisKey, options.windowSeconds);
    }

    if (count > options.limit) {
      const retryAfter = options.windowSeconds - (now % options.windowSeconds);

      Sentry.logger.warn(Sentry.logger.fmt`Rate limit exceeded for ${options.prefix}`, {
        count,
        limit: options.limit,
        prefix: options.prefix,
        retryAfter,
      });
      Sentry.metrics.count("rate_limit_exceeded", 1, {
        attributes: { prefix: options.prefix },
      });

      throw new RateLimitError(retryAfter);
    }
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw error;
    }
    // When Redis is unreachable (e.g. expired free tier or local offline), fail open
    console.warn(
      "[RateLimit] Redis unavailable, failing open:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
