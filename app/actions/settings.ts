"use server";

import * as Sentry from "@sentry/nextjs";
import { generateText } from "ai";
import { createAzure } from "@ai-sdk/azure";
import { buildModelFromCredential } from "@/agent/model-config";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import {
  deleteUserProviderCredential,
  getUserModelPreference,
  getUserProviderCredential,
  setActiveProvider,
  upsertUserProviderCredential,
} from "@/lib/db/queries";
import { AI_PROVIDER_VALUES, type AiProvider } from "@/lib/db/schema";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  listAnthropicModels,
  listGoogleModels,
  listMistralModels,
  listOpenAiCompatibleModels,
} from "@/lib/provider-models";
import { getServerViewer } from "@/lib/session";

const MODEL_LIST_LIMIT = 20;
const MODEL_LIST_WINDOW_SECONDS = 60 * 60;
const LOCAL_PROVIDERS = new Set<AiProvider>(["ollama", "foundry-local"]);

async function requireViewer() {
  const viewer = await getServerViewer();

  if (!viewer) {
    throw new Error("Sign in with Vercel to continue.");
  }

  return viewer;
}

function requireKey(credentials: { readonly apiKey?: string }) {
  if (!credentials.apiKey) {
    throw new Error("An API key is required.");
  }

  return credentials.apiKey;
}

function requireBaseUrl(credentials: { readonly baseUrl?: string }) {
  if (!credentials.baseUrl) {
    throw new Error("A base URL is required.");
  }

  return credentials.baseUrl;
}

export async function listModelsForProviderAction(
  provider: Exclude<AiProvider, "azure">,
  credentials: { readonly apiKey?: string; readonly baseUrl?: string },
) {
  const viewer = await requireViewer();

  await enforceRateLimit({
    key: viewer.id,
    limit: MODEL_LIST_LIMIT,
    prefix: "model-list",
    windowSeconds: MODEL_LIST_WINDOW_SECONDS,
  });

  switch (provider) {
    case "anthropic":
      return listAnthropicModels(requireKey(credentials));
    case "google":
      return listGoogleModels(requireKey(credentials));
    case "mistral":
      return listMistralModels(requireKey(credentials));
    case "ollama":
    case "foundry-local":
      return listOpenAiCompatibleModels(requireBaseUrl(credentials), credentials.apiKey);
  }
}

// Fetches the model list using the ALREADY-SAVED credential — powers "Fetch models" inside the
// Edit dialog when the user hasn't typed a new key, so re-fetching never requires re-entering it.
export async function listModelsForStoredProviderAction(provider: Exclude<AiProvider, "azure">) {
  const viewer = await requireViewer();

  await enforceRateLimit({
    key: viewer.id,
    limit: MODEL_LIST_LIMIT,
    prefix: "model-list",
    windowSeconds: MODEL_LIST_WINDOW_SECONDS,
  });

  const credential = await getUserProviderCredential(viewer.id, provider);

  if (!credential) {
    throw new Error("Configure this provider first.");
  }

  const apiKey = credential.encryptedApiKey ? decryptSecret(credential.encryptedApiKey) : undefined;

  if (provider === "ollama" || provider === "foundry-local") {
    if (!credential.baseUrl) {
      throw new Error("Missing base URL on stored credential.");
    }

    return listOpenAiCompatibleModels(credential.baseUrl, apiKey);
  }

  return listModelsForProviderAction(provider, { apiKey });
}

// Tests raw, not-yet-saved form values (used inside the Azure configure dialog, before Save).
export async function testAzureCredentialAction(input: {
  readonly resourceName: string;
  readonly deploymentName: string;
  readonly apiKey: string;
  readonly apiVersion?: string;
}) {
  const viewer = await requireViewer();

  await enforceRateLimit({
    key: viewer.id,
    limit: MODEL_LIST_LIMIT,
    prefix: "model-list",
    windowSeconds: MODEL_LIST_WINDOW_SECONDS,
  });

  const model = createAzure({
    apiKey: input.apiKey,
    apiVersion: input.apiVersion || "2024-10-21",
    resourceName: input.resourceName,
  })(input.deploymentName);

  try {
    await generateText({
      experimental_telemetry: { functionId: "azure_credential_test", isEnabled: true },
      maxOutputTokens: 1,
      model,
      prompt: "ping",
    });
    return { ok: true as const };
  } catch (error) {
    Sentry.logger.error(Sentry.logger.fmt`Azure credential test failed for ${viewer.id}`, {
      error: error instanceof Error ? error.message : String(error),
      resourceName: input.resourceName,
    });
    throw new Error(
      "Could not reach that Azure deployment. Check the resource name, deployment name, and key.",
    );
  }
}

// Tests an ALREADY-SAVED credential in place — powers the per-card "Test" button for
// every provider, without the client ever re-sending (or the server ever re-displaying) the key.
export async function testStoredProviderCredentialAction(provider: AiProvider) {
  const viewer = await requireViewer();

  await enforceRateLimit({
    key: viewer.id,
    limit: MODEL_LIST_LIMIT,
    prefix: "model-list",
    windowSeconds: MODEL_LIST_WINDOW_SECONDS,
  });

  const credential = await getUserProviderCredential(viewer.id, provider);

  if (!credential) {
    throw new Error("Configure this provider first.");
  }

  try {
    if (provider === "azure") {
      await generateText({
        experimental_telemetry: { functionId: "stored_credential_test", isEnabled: true },
        maxOutputTokens: 1,
        model: buildModelFromCredential(credential),
        prompt: "ping",
      });
    } else {
      const apiKey = credential.encryptedApiKey ? decryptSecret(credential.encryptedApiKey) : undefined;

      if (provider === "ollama" || provider === "foundry-local") {
        if (!credential.baseUrl) {
          throw new Error("Missing base URL on stored credential.");
        }

        await listOpenAiCompatibleModels(credential.baseUrl, apiKey);
      } else {
        await listModelsForProviderAction(provider, { apiKey });
      }
    }

    return { ok: true as const };
  } catch (error) {
    Sentry.logger.error(Sentry.logger.fmt`Stored credential test failed for ${provider}`, {
      error: error instanceof Error ? error.message : String(error),
      provider,
      userId: viewer.id,
    });
    throw new Error(
      "Could not reach this provider with the saved credential. It may need to be re-configured.",
    );
  }
}

export async function saveProviderCredentialAction(input: {
  readonly provider: AiProvider;
  readonly apiKey?: string;
  readonly model?: string;
  readonly azureResourceName?: string;
  readonly azureApiVersion?: string;
  readonly baseUrl?: string;
}) {
  const viewer = await requireViewer();

  if (!AI_PROVIDER_VALUES.includes(input.provider)) {
    throw new Error("Invalid provider.");
  }

  if (input.provider === "azure" && (!input.azureResourceName || !input.model)) {
    throw new Error("Azure requires a resource name and deployment name.");
  }

  if (LOCAL_PROVIDERS.has(input.provider) && !input.baseUrl) {
    throw new Error("A base URL is required.");
  }

  const existing = await getUserProviderCredential(viewer.id, input.provider);

  if (!input.apiKey && !existing && !LOCAL_PROVIDERS.has(input.provider)) {
    throw new Error("An API key is required.");
  }

  // Editing without retyping the key keeps the previously stored (encrypted) one.
  const encryptedApiKey = input.apiKey
    ? encryptSecret(input.apiKey)
    : (existing?.encryptedApiKey ?? null);

  await upsertUserProviderCredential({
    azureApiVersion: input.azureApiVersion ?? null,
    azureResourceName: input.azureResourceName ?? null,
    baseUrl: input.baseUrl ?? null,
    encryptedApiKey,
    model: input.model ?? null,
    provider: input.provider,
    userId: viewer.id,
  });
  await setActiveProvider(viewer.id, input.provider);

  Sentry.logger.info(Sentry.logger.fmt`${viewer.id} configured provider ${input.provider}`, {
    keyRotated: Boolean(input.apiKey),
    model: input.model,
    provider: input.provider,
    userId: viewer.id,
  });
  Sentry.metrics.count("provider_configured", 1, {
    attributes: { provider: input.provider },
  });

  return { ok: true as const };
}

export async function setActiveProviderAction(provider: AiProvider | null) {
  const viewer = await requireViewer();

  if (provider) {
    const existing = await getUserProviderCredential(viewer.id, provider);

    if (!existing) {
      throw new Error("Configure this provider before activating it.");
    }
  }

  await setActiveProvider(viewer.id, provider);

  return { ok: true as const };
}

export async function deleteProviderCredentialAction(provider: AiProvider) {
  const viewer = await requireViewer();

  await deleteUserProviderCredential(viewer.id, provider);

  const preference = await getUserModelPreference(viewer.id);

  if (preference === provider) {
    await setActiveProvider(viewer.id, null);
  }

  return { ok: true as const };
}
