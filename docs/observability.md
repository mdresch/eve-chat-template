# Observability

This document explains how Sentry is wired into the template: instrumentation
setup, and what gets logged or measured beyond Sentry's automatic Next.js
error/performance capture.

## Instrumentation Files

Sentry's Next.js SDK (`@sentry/nextjs`) is initialized from four files at the
project root:

| File | Runtime |
| --- | --- |
| `instrumentation.ts` | Registers `sentry.server.config.ts` (Node runtime) or `sentry.edge.config.ts` (edge runtime) via Next.js's `register()` hook, and exports `onRequestError = Sentry.captureRequestError`. |
| `instrumentation-client.ts` | Browser init: `Sentry.init(...)`, session replay, and `onRouterTransitionStart` for route-change spans. |
| `sentry.server.config.ts` | Node server init: traces, logs. |
| `sentry.edge.config.ts` | Edge runtime init (middleware, edge routes) — separate from Vercel's Edge Runtime; also used when running locally. |

All four currently share one DSN and the same core options:

- `tracesSampleRate: 1` — every transaction is traced. Lower this in
  production if trace volume becomes a cost concern.
- `enableLogs: true` — `Sentry.logger.*` calls (see below) are sent, not just
  captured exceptions.
- `instrumentation-client.ts` additionally enables `replayIntegration()`,
  with `replaysSessionSampleRate: 0.1` (10% of sessions) and
  `replaysOnErrorSampleRate: 1.0` (always replay a session that errors).

`dataCollection` is present but commented out in all three server-side
configs — uncomment `userInfo: false` / `httpBodies: []` there if you need to
stop sending user data or HTTP bodies to Sentry. See the
[Next.js SDK data collection options](https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection).

## What Gets Tracked Beyond The Defaults

Sentry's automatic instrumentation covers unhandled errors, request traces,
and route transitions. This template adds explicit user/session context,
structured logs, and custom metrics in a few places:

### User And Session Context

`agent/model-config.ts`'s `definePerUserModel` runs on every agent step and
calls:

```ts
Sentry.setUser({ id: userId });
Sentry.setConversationId(ctx.session.id);
```

This tags every Sentry event emitted during that step with the signed-in
user and the eve session id, so errors and traces from a given chat turn can
be traced back to who triggered them. Anonymous sessions (no signed-in
viewer) skip this — see
[Per-User AI Providers](byok-model-providers.md#runtime-resolution).

### Structured Logs (`Sentry.logger`)

| Location | Level | When |
| --- | --- | --- |
| `agent/model-config.ts` | `warn` | A user's configured BYOK provider failed to build a model; the agent fell back to the default. |
| `app/actions/settings.ts` | `error` | An Azure or stored-provider credential test failed. |
| `app/actions/settings.ts` | `info` | A user saved/activated a provider credential. |
| `lib/rate-limit.ts` | `warn` | A rate limit was exceeded. |
| `app/api/sentry-example-api/route.ts` | `info` | Sentry's example error-monitoring test route was hit. |

Logs use `Sentry.logger.fmt` for structured interpolation
(`` Sentry.logger.warn(Sentry.logger.fmt`... ${value}`, { ...attributes }) ``)
so values are queryable as attributes in Sentry, not just baked into a
message string.

### Custom Metrics

| Metric | Type | Location | Meaning |
| --- | --- | --- | --- |
| `model_fallback` | count | `agent/model-config.ts` | A BYOK provider failed and the agent used the default model instead. Tagged with `provider`. |
| `provider_configured` | count | `app/actions/settings.ts` | A user saved a provider credential. Tagged with `provider`. |
| `web_search_duration` | distribution (ms) | `agent/tools/web_search.ts` | Latency of each Exa API call. Tagged with the HTTP `status`. |
| `rate_limit_exceeded` | count | `lib/rate-limit.ts` | A rate limit was hit. Tagged with the limit's `prefix`. |

Use these (alongside `model_fallback` logs) to see how often BYOK providers
are actually failing over to the default model in practice — see
[Per-User AI Providers](byok-model-providers.md) for the full fallback flow,
including the short-lived Redis notice that surfaces a fallback to the
affected user in the chat UI.

## Verifying Sentry Is Wired Up

`app/api/sentry-example-api/route.ts` is a route handler that always throws,
kept from Sentry's Next.js wizard scaffold as a manual way to confirm error
capture end-to-end: hit `GET /api/sentry-example-api` and check that the
error shows up in the Sentry project for this DSN.

## Required Configuration

The DSN is currently hardcoded in the instrumentation files rather than read
from an environment variable. To point this template at a different Sentry
project, edit the `dsn` value in `instrumentation-client.ts`,
`sentry.server.config.ts`, and `sentry.edge.config.ts`.
