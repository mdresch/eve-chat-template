import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { decryptSecret } from "@/lib/crypto/secret-box";
import type { UserProviderCredential } from "@/lib/db/schema";

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

function requireModel(credential: UserProviderCredential) {
  return requireField(credential.model, "model");
}

function requireField(value: string | null | undefined, label: string) {
  if (!value) {
    throw new Error(`Missing ${label} on stored credential.`);
  }

  return value;
}
