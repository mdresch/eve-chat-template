import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";
import { definePerUserModel } from "@/agent/model-config";

export default defineAgent({
  description: "Turns a Business Case into a PMBOK Project Charter (4.1 Develop Project Charter).",
  model: definePerUserModel(anthropic("claude-sonnet-5")),
});
