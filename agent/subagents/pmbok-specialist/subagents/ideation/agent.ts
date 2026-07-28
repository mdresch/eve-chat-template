import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";
import { definePerUserModel } from "@/agent/model-config";

export default defineAgent({
  description: "Turns a raw project idea (plus an optional template) into a structured Ideation Document.",
  model: definePerUserModel(anthropic("claude-sonnet-5")),
});
