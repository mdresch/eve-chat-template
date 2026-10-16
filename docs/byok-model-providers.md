# Per-User AI Providers (BYOK)

This document explains the "bring your own key" model provider system: how a
signed-in user can point their own chats at a different model provider, how
credentials are stored, and how the agent picks a model at runtime.

By default every chat uses the model built into `agent/agent.ts`
(`claude-sonnet-5` through Anthropic, no key required). BYOK lets a signed-in
user override that default per account, not per chat.

## Supported Providers

Defined in `lib/db/schema.ts` as `AI_PROVIDER_VALUES`:

| Provider | Needs API key | Needs base URL | Notes |
| --- | --- | --- | --- |
| `anthropic` | Yes | No | |
| `google` | Yes | No | Google Gemini |
| `mistral` | Yes | No | |
| `azure` | Yes | No | Needs resource name + deployment name instead of a model list |
| `ollama` | Optional | Yes | Runs locally; only works while the app itself runs on `pnpm dev` |
| `foundry-local` | Optional | Yes | Microsoft Foundry Local; same local-only caveat as Ollama |
| `bifrost` | Yes | Yes | Self-hosted Bifrost gateway (OpenAI-compatible) |
| `merge-gateway` | Yes | Yes | Merge Gateway (OpenAI-compatible) |

`BASE_URL_PROVIDERS` (`lib/db/schema.ts`) is the list that needs a Base URL
field in the UI: `ollama`, `foundry-local`, `bifrost`, `merge-gateway`. This is a separate
concept from "key optional" — Ollama/Foundry Local commonly run with no key,
Bifrost and Merge Gateway always need one.

## Settings UI

The settings page is `app/(chat)/settings/page.tsx`, rendered by
`components/settings/model-settings-form.tsx` (`ModelSettingsForm`). It shows:

- A "Default" card (no key required) — always available.
- One card per provider in `PROVIDER_LABELS`, showing whether it is
  configured and/or active.

Configuring a provider opens `ConfigureDialog`, which:

1. Collects the API key (and base URL / Azure resource+deployment fields
   where applicable).
2. Lets the user **Fetch models** (non-Azure) to populate a model dropdown,
   or **Test connection** (Azure, since Azure has no list-models call).
3. Saves through `saveProviderCredentialAction`, which also activates the
   provider immediately.

Each configured provider card also gets **Test**, **Edit**, and **Remove**
actions, plus a **Use this** button to switch the active provider without
reconfiguring it. Editing a credential without retyping the API key keeps the
previously stored (encrypted) key — the key is never redisplayed once saved.

All of this is driven by Server Actions in `app/actions/settings.ts`:

- `listModelsForProviderAction` / `listModelsForStoredProviderAction` — list
  available models for a provider, either from freshly typed credentials or
  from what's already saved.
- `testAzureCredentialAction` / `testStoredProviderCredentialAction` — send a
  1-token `generateText` call (or list models) to confirm the credential
  actually works.
- `saveProviderCredentialAction` — validates required fields per provider,
  encrypts the key, upserts `user_provider_credential`, and activates the
  provider.
- `setActiveProviderAction` — switches the active provider without touching
  stored credentials; passing `null` reverts to the built-in default.
- `deleteProviderCredentialAction` — removes a stored credential; if it was
  the active provider, falls back to the default.

Model lookups for non-Azure providers live in `lib/provider-models.ts`
(`listAnthropicModels`, `listGoogleModels`, `listMistralModels`,
`listOpenAiCompatibleModels`, `listBifrostModels`). All settings actions are
rate-limited per user (`enforceRateLimit`, `model-list` prefix, 20 requests /
hour) and require a signed-in viewer.

## Storage

Two tables in `lib/db/schema.ts`:

```ts
userModelPreference: { userId (PK), activeProvider: AiProvider | null }
userProviderCredential: {
  (userId, provider) PK,
  encryptedApiKey: string | null,
  model: string | null,          // deployment name for azure
  azureResourceName, azureApiVersion,
  baseUrl,                        // ollama / foundry-local / bifrost
}
```

A user can have a stored credential per provider, but only one
`activeProvider` at a time. Switching providers with `setActiveProviderAction`
does not delete other stored credentials, so switching back doesn't require
reconfiguring.

### Encryption

API keys are encrypted at rest with AES-256-GCM in
`lib/crypto/secret-box.ts` (`encryptSecret` / `decryptSecret`), keyed by the
`MODEL_KEY_ENCRYPTION_SECRET` environment variable (32 bytes, base64-encoded).
Each encrypted payload is `<iv>.<authTag>.<ciphertext>`, all base64. Losing or
rotating `MODEL_KEY_ENCRYPTION_SECRET` makes every previously stored key
undecryptable — treat it like any other production secret.

Generate one with:

```bash
openssl rand -base64 32
```

## Runtime Resolution

`agent/model-config.ts` is imported by every `agent.ts` in the project (the
root agent and every subagent, including nested ones under
`agent/subagents/`). Each declares its model as:

```ts
model: definePerUserModel(anthropic("claude-sonnet-5"))
```

`definePerUserModel(fallback)` wraps `fallback` in eve's `defineDynamic`,
hooking `step.started`. On every step it:

1. Reads the signed-in user from `ctx.session.auth.current`. No user (e.g.
   Slack, local dev without auth) → use `fallback`.
2. Calls `Sentry.setUser({ id: userId })` and `Sentry.setConversationId`.
3. Looks up `getUserModelPreference(userId)`. No preference → use `fallback`.
4. Looks up the stored credential for that provider. Missing → use
   `fallback`.
5. Calls `buildModelFromCredential(credential)`, which decrypts the key and
   constructs a `LanguageModel` via the matching AI SDK provider
   (`@ai-sdk/anthropic`, `@ai-sdk/azure`, `@ai-sdk/google`, `@ai-sdk/mistral`,
   or `@ai-sdk/openai-compatible` for Ollama/Foundry Local/Bifrost).
6. If building the model throws (bad key, unreachable endpoint, etc.), log a
   Sentry warning, increment the `model_fallback` metric, record a fallback
   notice (see below), and fall back to `fallback` rather than failing the
   turn.

`fallback` must be a direct provider `LanguageModel`
(`anthropic("claude-sonnet-5")`), not a `"provider/model"` Vercel AI Gateway
id string — the gateway routes through its own funded credit balance
independent of any user's BYOK key, which would defeat the purpose.

### Fallback Notice

If a user's configured provider fails mid-turn and the agent silently falls
back to the default model, the user should still find out. That path is:

1. `recordModelFallbackNotice(sessionId, provider)` (`lib/model-fallback-notice.ts`)
   writes a short-lived key (`model-fallback:<sessionId>`, 5 minute TTL) to
   Upstash Redis.
2. After a turn settles, `app/_components/agent-chat.tsx` calls
   `checkModelFallbackNoticeAction(session.sessionId)`
   (`app/actions/chat.ts` → `consumeModelFallbackNotice`), which reads and
   deletes that key.
3. If a provider name comes back, the UI surfaces that the turn actually ran
   on the default model instead of the user's configured provider.

This uses the same Upstash Redis instance as rate limiting (see
[How the Chatbot Works](how-the-chatbot-works.md#rate-limiting)) and degrades
to a no-op if Redis env vars are not configured.

## Adding A New Provider

1. Add the provider id to `AI_PROVIDER_VALUES` in `lib/db/schema.ts` (and to
   `BASE_URL_PROVIDERS` if it needs a base URL).
2. Add a case to `buildModelFromCredential` in `agent/model-config.ts`.
3. Add a model-listing function in `lib/provider-models.ts` if the provider
   supports listing models, and wire it into
   `listModelsForProviderAction`/`listModelsForStoredProviderAction` in
   `app/actions/settings.ts`.
4. Add a label to `PROVIDER_LABELS` (and `LOCAL_PROVIDERS`/
   `DEFAULT_LOCAL_BASE_URL` if relevant) in
   `components/settings/model-settings-form.tsx`.

## Required Environment Variable

```bash
MODEL_KEY_ENCRYPTION_SECRET=
```

Required for BYOK to work at all — without it, `encryptSecret`/`decryptSecret`
throw and saving/using a stored credential fails. Not required for chats that
only use the built-in default model.
