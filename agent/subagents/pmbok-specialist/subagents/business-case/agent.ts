import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";
import { definePerUserModel } from "@/agent/model-config";

export default defineAgent({
  description: "Turns an Ideation Document into a PMBOK-style Business Case.",
  model: definePerUserModel(anthropic("claude-sonnet-5")),
});
