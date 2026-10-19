import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createRedisClient,
  getRedisClientSingleton,
  getRedisEnv,
  isRedisHealthy,
  resetRedisClientStateForTesting,
} from "../redis-client.ts";

describe("lib/redis-client", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetRedisClientStateForTesting();
    process.env = { ...originalEnv };
  });

  describe("getRedisEnv", () => {
    test("resolves standard UPSTASH_REDIS variables", () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.com";
      process.env.UPSTASH_REDIS_REST_TOKEN = "token-123";
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;

      const env = getRedisEnv();
      assert.deepEqual(env, {
        url: "https://example-upstash.com",
        token: "token-123",
      });
    });

    test("resolves Vercel KV fallback variables", () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      process.env.KV_REST_API_URL = "https://example-kv.com";
      process.env.KV_REST_API_TOKEN = "kv-token";

      const env = getRedisEnv();
      assert.deepEqual(env, {
        url: "https://example-kv.com",
        token: "kv-token",
      });
    });

    test("resolves eve_ prefixed variables", () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      process.env.eve_KV_REST_API_URL = "https://example-eve.com";
      process.env.eve_KV_REST_API_TOKEN = "eve-token";

      const env = getRedisEnv();
      assert.deepEqual(env, {
        url: "https://example-eve.com",
        token: "eve-token",
      });
    });

    test("returns null when configuration is missing", () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      delete process.env.eve_UPSTASH_REDIS_REST_URL;
      delete process.env.eve_UPSTASH_REDIS_REST_TOKEN;
      delete process.env.eve_KV_REST_API_URL;
      delete process.env.eve_KV_REST_API_TOKEN;
      delete process.env.REDIS_URL;
      delete process.env.KV_URL;

      const env = getRedisEnv();
      assert.equal(env, null);
    });
  });

  describe("createRedisClient error handling & retries", () => {
    test("throws when credentials are missing and throwOnFail is true", async () => {
      await assert.rejects(
        () => createRedisClient({ url: "", token: "", throwOnFail: true }),
        { message: /Redis REST URL or token not configured/ },
      );
    });

    test("returns null when credentials are missing and throwOnFail is false", async () => {
      const client = await createRedisClient({ url: "", token: "", throwOnFail: false });
      assert.equal(client, null);
    });

    test("retries and throws when ping consistently fails", async () => {
      const t0 = Date.now();
      await assert.rejects(
        () =>
          createRedisClient({
            url: "https://127.0.0.1:9999",
            token: "invalid-token",
            maxAttempts: 2,
            baseDelayMs: 20,
            throwOnFail: true,
          }),
        { message: /Unable to connect to Redis after 2 attempts/ },
      );
      assert.ok(Date.now() - t0 >= 20, "Should have applied backoff delay");
    });

    test("trips circuit breaker on repeated failure to protect request latency", async () => {
      // First call fails and trips circuit breaker
      const firstResult = await createRedisClient({
        url: "https://127.0.0.1:9999",
        token: "invalid-token",
        maxAttempts: 1,
        baseDelayMs: 5,
        throwOnFail: false,
      });
      assert.equal(firstResult, null);

      // Second call immediately fails open in < 10ms without attempting network request
      const t0 = Date.now();
      const secondResult = await createRedisClient({
        url: "https://127.0.0.1:9999",
        token: "invalid-token",
        maxAttempts: 3,
        throwOnFail: false,
      });
      const elapsed = Date.now() - t0;

      assert.equal(secondResult, null);
      assert.ok(elapsed < 20, `Circuit breaker should return immediately (took ${elapsed}ms)`);
    });
  });

  describe("singleton & health-check", () => {
    test("isRedisHealthy returns false for unreachable endpoint", async () => {
      const healthy = await isRedisHealthy({
        url: "https://127.0.0.1:9999",
        token: "invalid",
        maxAttempts: 1,
        baseDelayMs: 5,
      });
      assert.equal(healthy, false);
    });

    test("getRedisClientSingleton returns null when Redis is unreachable with throwOnFail: false", async () => {
      const client = await getRedisClientSingleton({
        url: "https://127.0.0.1:9999",
        token: "invalid",
        maxAttempts: 1,
        baseDelayMs: 5,
        throwOnFail: false,
      });
      assert.equal(client, null);
    });
  });
});
