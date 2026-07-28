import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";
import { definePerUserModel } from "@/agent/model-config";

export default defineAgent({
  description:
    "Turns a Project Charter and Stakeholder Register into the PMBOK subsidiary management plans and the integrated Project Management Plan (4.2 Develop Project Management Plan).",
  model: definePerUserModel(anthropic("claude-sonnet-5")),
});
