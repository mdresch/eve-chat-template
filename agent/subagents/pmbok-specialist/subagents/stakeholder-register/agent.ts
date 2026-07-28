import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";
import { definePerUserModel } from "@/agent/model-config";

export default defineAgent({
  description: "Turns a Business Case into a PMBOK Stakeholder Register (13.1 Identify Stakeholders).",
  model: definePerUserModel(anthropic("claude-sonnet-5")),
});
