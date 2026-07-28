import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import Sentry from "@sentry/nextjs";
import type { LanguageModel } from "ai";
import { defineDynamic } from "eve";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { getUserModelPreference, getUserProviderCredential } from "@/lib/db/queries";
import type { UserProviderCredential } from "@/lib/db/schema";
import { recordModelFallbackNotice } from "@/lib/model-fallback-notice";

export function buildModelFromCredential(credential: UserProviderCredential) {
  const apiKey = credential.encryptedApiKey ? decryptSecret(credential.encryptedApiKey) : undefined;

  switch (credential.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: requireField(apiKey, "API key") })(requireModel(credential));
    case "google":
      return createGoogleGenerativeAI({ apiKey: requireField(apiKey, "API key") })(
        requireModel(credential),
      );
    case "mistral":
      return createMistral({ apiKey: requireField(apiKey, "API key") })(requireModel(credential));
    case "azure":
      return createAzure({
        apiKey: requireField(apiKey, "API key"),
        apiVersion: credential.azureApiVersion || "2024-10-21",
        resourceName: requireField(credential.azureResourceName, "Azure resource name"),
      })(requireModel(credential));
    case "ollama":
    case "foundry-local":
      return createOpenAICompatible({
        apiKey,
        baseURL: requireField(credential.baseUrl, "base URL"),
        name: credential.provider,
      })(requireModel(credential));
    case "bifrost":
      return createOpenAICompatible({
        apiKey: requireField(apiKey, "API key"),
        baseURL: requireField(credential.baseUrl, "base URL"),
        name: "bifrost",
      })(requireModel(credential));
  }
}

// Shared by every agent.ts (root and subagents): resolves the signed-in
// user's stored provider preference per model step, falling back to
// `fallback` when the user has no preference, no stored credential, or the
// stored credential fails to build a model. `fallback` must be a direct
// provider LanguageModel (e.g. `anthropic("claude-sonnet-5")`), not a
// "provider/model" gateway id string — the latter routes through Vercel AI
// Gateway, which requires its own funded credit balance independent of any
// user's BYOK key.
export function definePerUserModel(fallback: LanguageModel) {
  return defineDynamic({
    events: {
      "step.started": async (_event, ctx) => {
        const userId = ctx.session.auth.current?.principalId;

        if (!userId) {
          return null;
        }

        Sentry.setUser({ id: userId });
        Sentry.setConversationId(ctx.session.id);

        const activeProvider = await getUserModelPreference(userId);

        if (!activeProvider) {
          return null;
        }

        const credential = await getUserProviderCredential(userId, activeProvider);

        if (!credential) {
          return null;
        }

        try {
          return buildModelFromCredential(credential);
        } catch (error) {
          Sentry.logger.warn(
            Sentry.logger.fmt`Falling back to the default model: ${activeProvider} was unusable`,
            {
              activeProvider,
              error: error instanceof Error ? error.message : String(error),
              sessionId: ctx.session.id,
              userId,
            },
          );
          Sentry.metrics.count("model_fallback", 1, {
            attributes: { provider: activeProvider },
          });
          await recordModelFallbackNotice(ctx.session.id, activeProvider);
          return null;
        }
      },
    },
    fallback,
  });
}

function requireModel(credential: UserProviderCredential) {
  return requireField(credential.model, "model");
}

function requireField(value: string | null | undefined, label: string) {
  if (!value) {
    throw new Error(`Missing ${label} on stored credential.`);
  }

  return value;
}
