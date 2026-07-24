export type ProviderModelOption = {
  readonly id: string;
  readonly label: string;
  readonly inputTokenLimit?: number;
  readonly outputTokenLimit?: number;
};

export async function listAnthropicModels(apiKey: string): Promise<ProviderModelOption[]> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: { "anthropic-version": "2023-06-01", "x-api-key": apiKey },
  });

  if (!res.ok) {
    throw new Error("Could not fetch Anthropic models. Check your API key.");
  }

  const { data } = (await res.json()) as {
    data: { id: string; display_name?: string; max_input_tokens?: number; max_tokens?: number }[];
  };

  return data.map((model) => ({
    id: model.id,
    inputTokenLimit: model.max_input_tokens || undefined,
    label: model.display_name ?? model.id,
    outputTokenLimit: model.max_tokens || undefined,
  }));
}

export async function listGoogleModels(apiKey: string): Promise<ProviderModelOption[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
  );

  if (!res.ok) {
    throw new Error("Could not fetch Google models. Check your API key.");
  }

  const { models } = (await res.json()) as {
    models: {
      name: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
      inputTokenLimit?: number;
      outputTokenLimit?: number;
    }[];
  };

  return models
    .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
    .map((model) => ({
      id: model.name.replace(/^models\//, ""),
      inputTokenLimit: model.inputTokenLimit,
      label: model.displayName ?? model.name,
      outputTokenLimit: model.outputTokenLimit,
    }));
}

export async function listMistralModels(apiKey: string): Promise<ProviderModelOption[]> {
  const res = await fetch("https://api.mistral.ai/v1/models", {
    headers: { authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error("Could not fetch Mistral models. Check your API key.");
  }

  const { data } = (await res.json()) as { data: { id: string; max_context_length?: number }[] };

  return data.map((model) => ({
    id: model.id,
    inputTokenLimit: model.max_context_length,
    label: model.id,
  }));
}

export async function listOpenAiCompatibleModels(
  baseUrl: string,
  apiKey?: string,
): Promise<ProviderModelOption[]> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
  });

  if (!res.ok) {
    throw new Error("Could not reach that server. Check the base URL (and that it's running).");
  }

  const { data } = (await res.json()) as { data: { id: string }[] };

  return data.map((model) => ({ id: model.id, label: model.id }));
}

// Bifrost's GET /v1/models returns the same { data: [{ id, ... }] } shape as
// any OpenAI-compatible server, so this just adds a clearer error message.
export async function listBifrostModels(
  baseUrl: string,
  apiKey: string,
): Promise<ProviderModelOption[]> {
  try {
    return await listOpenAiCompatibleModels(baseUrl, apiKey);
  } catch {
    throw new Error("Could not reach your Bifrost gateway. Check the base URL and key.");
  }
}
