"use server";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as Sentry from "@sentry/nextjs";
import { generateText } from "ai";
import { createAzure } from "@ai-sdk/azure";
import { buildModelFromCredential } from "@/agent/model-config";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import {
  deleteUserProviderCredential,
  getUserModelPreference,
  getUserProviderCredential,
  getUserSandboxPreference,
  setActiveProvider,
  setActiveSandbox,
  upsertUserProviderCredential,
  upsertUserSandboxPreference,
} from "@/lib/db/queries";
import {
  AI_PROVIDER_VALUES,
  BASE_URL_PROVIDERS,
  SANDBOX_PROVIDER_VALUES,
  type AiProvider,
  type SandboxProvider,
} from "@/lib/db/schema";
import {
  invalidateMxcConfigCache,
  listMxcSandboxInstances,
  mxcExecCommand,
  mxcPoolStatus,
} from "@/lib/mxc/client";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  listAnthropicModels,
  listBifrostModels,
  listMergeGatewayModels,
  listGoogleModels,
  listMistralModels,
  listOpenAiCompatibleModels,
  listVercelAiGatewayModels,
  VERCEL_AI_GATEWAY_DEFAULT_BASE_URL,
} from "@/lib/provider-models";
import { getServerViewer } from "@/lib/session";

const execFileAsync = promisify(execFile);

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

function requireKey(credentials: { readonly apiKey?: string }, envFallback?: string) {
  const resolved = credentials.apiKey || envFallback;
  if (!resolved) {
    throw new Error("An API key is required.");
  }

  return resolved;
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
    case "bifrost":
      return listBifrostModels(requireBaseUrl(credentials), requireKey(credentials));
    case "merge-gateway":
      return listMergeGatewayModels(requireBaseUrl(credentials), requireKey(credentials));
    case "ai-gateway":
      return listVercelAiGatewayModels(
        credentials.baseUrl || VERCEL_AI_GATEWAY_DEFAULT_BASE_URL,
        requireKey(credentials, process.env.AI_GATEWAY_API_KEY),
      );
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

  if (provider === "bifrost") {
    if (!credential.baseUrl) {
      throw new Error("Missing base URL on stored credential.");
    }

    return listBifrostModels(credential.baseUrl, requireKey({ apiKey }));
  }

  if (provider === "merge-gateway") {
    if (!credential.baseUrl) {
      throw new Error("Missing base URL on stored credential.");
    }

    return listMergeGatewayModels(credential.baseUrl, requireKey({ apiKey }));
  }

  if (provider === "ai-gateway") {
    return listVercelAiGatewayModels(
      credential.baseUrl || VERCEL_AI_GATEWAY_DEFAULT_BASE_URL,
      requireKey({ apiKey }, process.env.AI_GATEWAY_API_KEY),
    );
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
      } else if (provider === "bifrost") {
        if (!credential.baseUrl) {
          throw new Error("Missing base URL on stored credential.");
        }

        await listBifrostModels(credential.baseUrl, requireKey({ apiKey }));
      } else if (provider === "merge-gateway") {
        if (!credential.baseUrl) {
          throw new Error("Missing base URL on stored credential.");
        }

        await listMergeGatewayModels(credential.baseUrl, requireKey({ apiKey }));
      } else if (provider === "ai-gateway") {
        await listVercelAiGatewayModels(
          credential.baseUrl || VERCEL_AI_GATEWAY_DEFAULT_BASE_URL,
          requireKey({ apiKey }, process.env.AI_GATEWAY_API_KEY),
        );
        if (credential.model) {
          await generateText({
            experimental_telemetry: { functionId: "stored_credential_test", isEnabled: true },
            maxOutputTokens: 16,
            model: buildModelFromCredential(credential),
            prompt: "ping",
          });
        }
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
    const detail = error instanceof Error ? error.message : "";
    if (detail.includes("Free tier users do not have access")) {
      throw new Error(
        `Model "${credential.model}" requires paid AI Gateway credits. Select a Free Tier Ready model (e.g. openai/gpt-5-mini, openai/gpt-4.1, or google/gemini-2.5-flash).`,
      );
    }
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

  const effectiveBaseUrl =
    input.provider === "ai-gateway"
      ? (input.baseUrl || VERCEL_AI_GATEWAY_DEFAULT_BASE_URL)
      : input.baseUrl;

  if (BASE_URL_PROVIDERS.includes(input.provider) && !effectiveBaseUrl) {
    throw new Error("A base URL is required.");
  }

  const existing = await getUserProviderCredential(viewer.id, input.provider);
  const hasEnvKey = input.provider === "ai-gateway" && Boolean(process.env.AI_GATEWAY_API_KEY);

  if (!input.apiKey && !existing && !LOCAL_PROVIDERS.has(input.provider) && !hasEnvKey) {
    throw new Error("An API key is required.");
  }

  // Editing without retyping the key keeps the previously stored (encrypted) one.
  const encryptedApiKey = input.apiKey
    ? encryptSecret(input.apiKey)
    : (existing?.encryptedApiKey ?? null);

  await upsertUserProviderCredential({
    azureApiVersion: input.azureApiVersion ?? null,
    azureResourceName: input.azureResourceName ?? null,
    baseUrl: effectiveBaseUrl ?? null,
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

export async function setActiveSandboxAction(provider: SandboxProvider | null) {
  const viewer = await requireViewer();

  if (provider && !SANDBOX_PROVIDER_VALUES.includes(provider)) {
    throw new Error("Invalid sandbox runtime.");
  }

  await setActiveSandbox(viewer.id, provider);
  invalidateMxcConfigCache();

  return { ok: true as const };
}

export async function saveSandboxPreferenceAction(input: {
  readonly activeSandbox: SandboxProvider | null;
  readonly mcpUrl?: string;
  readonly remoteHost?: string;
  readonly repoRoot?: string;
  readonly defaultSandboxId?: string;
  readonly dockerImage?: string;
}) {
  const viewer = await requireViewer();

  if (input.activeSandbox && !SANDBOX_PROVIDER_VALUES.includes(input.activeSandbox)) {
    throw new Error("Invalid sandbox runtime.");
  }

  const existing = await getUserSandboxPreference(viewer.id);

  await upsertUserSandboxPreference({
    activeSandbox: input.activeSandbox,
    defaultSandboxId:
      input.defaultSandboxId !== undefined
        ? input.defaultSandboxId.trim() || null
        : existing.defaultSandboxId,
    dockerImage:
      input.dockerImage !== undefined
        ? input.dockerImage.trim() || null
        : existing.dockerImage,
    mcpUrl:
      input.mcpUrl !== undefined ? input.mcpUrl.trim() || null : existing.mcpUrl,
    remoteHost:
      input.remoteHost !== undefined
        ? input.remoteHost.trim() || null
        : existing.remoteHost,
    repoRoot:
      input.repoRoot !== undefined
        ? input.repoRoot.trim() || null
        : existing.repoRoot,
    userId: viewer.id,
  });

  invalidateMxcConfigCache();

  return { ok: true as const };
}

export async function listMxcSandboxInstancesAction(options?: {
  readonly mcpUrl?: string;
}) {
  const viewer = await requireViewer();
  await enforceRateLimit({
    key: viewer.id,
    limit: MODEL_LIST_LIMIT,
    prefix: "sandbox-list",
    windowSeconds: MODEL_LIST_WINDOW_SECONDS,
  });

  return listMxcSandboxInstances(options?.mcpUrl);
}

export async function testSandboxProviderAction(
  provider: SandboxProvider,
): Promise<{ readonly message: string }> {
  const viewer = await requireViewer();
  await enforceRateLimit({
    key: viewer.id,
    limit: MODEL_LIST_LIMIT,
    prefix: "sandbox-test",
    windowSeconds: MODEL_LIST_WINDOW_SECONDS,
  });

  const pref = await getUserSandboxPreference(viewer.id);

  if (provider === "docker") {
    const dockerExe = process.env.EVE_DOCKER_PATH || "docker";
    try {
      const { stdout } = await execFileAsync(
        dockerExe,
        ["version", "--format", "{{.Server.Version}}"],
        { timeout: 3500 },
      );
      const ver = stdout.trim();
      return {
        message: `Docker daemon reachable (Engine v${ver || "active"} · Image: ${pref.dockerImage || "node:22-bookworm"}).`,
      };
    } catch (error) {
      throw new Error(
        `Docker daemon unreachable (${error instanceof Error ? error.message : "check Docker Desktop"}).`,
      );
    }
  }

  if (provider === "vercel-sandbox") {
    const hasVercelEnv = Boolean(
      process.env.VERCEL ||
        process.env.VERCEL_OIDC_TOKEN ||
        process.env.VERCEL_SANDBOX_TOKEN,
    );
    if (!hasVercelEnv) {
      return {
        message:
          "Vercel Sandbox is ready for cloud deployments (activates automatically when deployed on Vercel or when VERCEL_OIDC_TOKEN is present).",
      };
    }
    return {
      message: "Vercel Sandbox cloud microVM credentials detected.",
    };
  }

  if (provider === "mxc" || provider === "hyperv") {
    invalidateMxcConfigCache();
    const pool = await mxcPoolStatus(pref.mcpUrl);
    const execRes = await mxcExecCommand("hostname", {
      sandboxId: pref.defaultSandboxId || undefined,
    });
    if (execRes.exitCode !== 0) {
      throw new Error(execRes.stderr || "Guest command execution failed.");
    }
    const hostLine = execRes.stdout.split(/\r?\n/)[0]?.trim() || "guest";
    return {
      message: `Connected to ${execRes.sandboxId} (Host: ${hostLine} · Standby Pool: ${pool.ready_count}/${pool.target_size} ready).`,
    };
  }

  throw new Error(`Unsupported sandbox provider: ${provider}`);
}
