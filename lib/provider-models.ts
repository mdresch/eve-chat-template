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

export async function listMergeGatewayModels(
  baseUrl: string,
  apiKey: string,
): Promise<ProviderModelOption[]> {
  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/models`;
    const res = await fetch(url, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(
        `Merge Gateway returned ${res.status}: ${errorText || "Check base URL and API key."}`
      );
    }

    const json = await res.json();

    // Handle both standard OpenAI format and Merge Gateway format
    // Standard: { data: [{ id: "..." }, ...] }
    // Merge Gateway: { object: "list", data: [{ model: "id", display_name: "...", ... }, ...] }
    let rawModels: Array<{ id?: string; model?: string; display_name?: string }>;

    // Standard OpenAI format or Merge Gateway format: { data: [...] }
    if (json.data && Array.isArray(json.data)) {
      rawModels = json.data;
    }
    // Direct array: [{ ... }, ...]
    else if (Array.isArray(json)) {
      rawModels = json;
    }
    // Merge Gateway might wrap in: { data: { models: [...] } }
    else if (json.data && json.data.models && Array.isArray(json.data.models)) {
      rawModels = json.data.models;
    }
    // Alternative: { models: [...] }
    else if (json.models && Array.isArray(json.models)) {
      rawModels = json.models;
    }
    else {
      throw new Error(
        `Unexpected response format from Merge Gateway. Received: ${JSON.stringify(json).substring(0, 200)}`
      );
    }

    // Map to ProviderModelOption - handle both id and model fields
    return rawModels
      .map((m) => {
        const id = m.id || m.model;
        if (!id) return null;
        return {
          id,
          label: m.display_name || id,
        };
      })
      .filter((m): m is ProviderModelOption => m !== null);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Merge Gateway error: ${error.message}`);
    }
    throw new Error("Could not reach your Merge Gateway. Check the base URL and key.");
  }
}

export const VERCEL_AI_GATEWAY_DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1";

export async function listVercelAiGatewayModels(
  baseUrl: string = VERCEL_AI_GATEWAY_DEFAULT_BASE_URL,
  apiKey: string,
): Promise<ProviderModelOption[]> {
  try {
    const endpoint = `${(baseUrl || VERCEL_AI_GATEWAY_DEFAULT_BASE_URL).replace(/\/+$/, "")}/models`;
    const res = await fetch(endpoint, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(
        `Vercel AI Gateway returned ${res.status}: ${errorText || "Check your AI_GATEWAY_API_KEY and base URL."}`,
      );
    }

    const json = (await res.json()) as {
      data?: Array<{
        id?: string;
        name?: string;
        display_name?: string;
        type?: string;
        context_window?: number;
        max_input_tokens?: number;
        max_tokens?: number;
      }>;
      models?: Array<{
        id?: string;
        name?: string;
        display_name?: string;
        type?: string;
        context_window?: number;
        max_input_tokens?: number;
        max_tokens?: number;
      }>;
    };

    const rawModels = Array.isArray(json.data)
      ? json.data
      : Array.isArray(json.models)
        ? json.models
        : [];

    const freeTierVerifiedIds = new Set([
      "openai/gpt-5-mini",
      "openai/gpt-5-nano",
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "openai/gpt-4.1-nano",
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "google/gemini-2.5-flash",
      "meta/llama-3.3-70b",
      "alibaba/qwen-3-14b",
      "mistral/mistral-small",
      "nvidia/nemotron-3.5-lightning-free",
      "poolside/laguna-s-2.1-free",
    ]);

    const options: ProviderModelOption[] = rawModels
      .filter((m) => !m.type || m.type === "language")
      .map((m) => {
        if (!m.id) return null;
        const baseLabel = m.name ?? m.display_name ?? m.id;
        const isFreeTier = freeTierVerifiedIds.has(m.id);
        return {
          id: m.id,
          inputTokenLimit: m.context_window ?? m.max_input_tokens ?? undefined,
          label: isFreeTier ? `${baseLabel} (${m.id} · Free Tier Ready)` : `${baseLabel} (${m.id})`,
          outputTokenLimit: m.max_tokens ?? undefined,
        } as ProviderModelOption;
      })
      .filter((m): m is ProviderModelOption => m !== null)
      .sort((a, b) => {
        const aFree = freeTierVerifiedIds.has(a.id) ? 0 : 1;
        const bFree = freeTierVerifiedIds.has(b.id) ? 0 : 1;
        if (aFree !== bFree) return aFree - bFree;
        return a.id.localeCompare(b.id);
      });

    // Ensure the featured getting-started slug (openai/gpt-6-astra) is also selectable
    if (!options.some((m) => m.id === "openai/gpt-6-astra")) {
      options.push({
        id: "openai/gpt-6-astra",
        label: "openai/gpt-6-astra (Paid Credits Only)",
      });
    }

    return options;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Vercel AI Gateway error: ${error.message}`);
    }
    throw new Error("Could not reach Vercel AI Gateway. Check your API key and base URL.");
  }
}
