import * as Sentry from "@sentry/nextjs";
import { defineTool } from "eve/tools";
import { z } from "zod";

type ExaResult = {
  readonly title: string | null;
  readonly url: string;
  readonly publishedDate?: string;
  readonly text?: string;
};

export default defineTool({
  description: "Search the web for current information.",
  inputSchema: z.object({ query: z.string().min(1) }),
  async execute({ query }) {
    const apiKey = process.env.EXA_API_KEY;

    if (!apiKey) {
      throw new Error("Web search is not configured (missing EXA_API_KEY).");
    }

    const startedAt = Date.now();
    const res = await fetch("https://api.exa.ai/search", {
      body: JSON.stringify({
        contents: { text: { maxCharacters: 1000 } },
        numResults: 5,
        query,
      }),
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      method: "POST",
    });

    Sentry.metrics.distribution("web_search_duration", Date.now() - startedAt, {
      attributes: { status: res.status },
      unit: "millisecond",
    });

    if (!res.ok) {
      throw new Error("Web search failed.");
    }

    const { results } = (await res.json()) as { results: ExaResult[] };

    return results.map((result) => ({
      publishedDate: result.publishedDate ?? null,
      snippet: result.text ?? null,
      title: result.title ?? result.url,
      url: result.url,
    }));
  },
});
