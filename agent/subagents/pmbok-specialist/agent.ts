import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";
import { definePerUserModel } from "@/agent/model-config";

export default defineAgent({
  description:
    "Seasoned PMBOK-certified Project Manager / Business Analyst. Delegate here whenever the user wants to turn a raw idea into a project: it runs the idea through a PMBOK-aligned deliverable pipeline (Ideation Document, Business Case, Stakeholder Register, Project Charter, Management Plans), drafting each with its own nested specialist and publishing every deliverable to Notion, Linear, or Shortcut.",
  model: definePerUserModel(anthropic("claude-opus-5")),
});
