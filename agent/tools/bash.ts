import { defineTool } from "eve/tools";
import { bash } from "eve/tools/defaults";
import { recordChatSandboxContainer } from "@/lib/db/queries";

// Wraps eve's framework-default `bash` tool (already auto-available once
// agent/sandbox.ts exists) to also report the sandbox's container name, so
// the chat UI can show which Docker container the workspace lives in.
export default defineTool({
  ...bash,
  async execute(input, ctx) {
    const result = (await bash.execute(input, ctx)) as Record<string, unknown>;
    const sandbox = await ctx.getSandbox();

    void recordChatSandboxContainer({
      containerName: sandbox.id,
      sessionId: ctx.session.id,
    }).catch((error) => {
      console.warn("Failed to record sandbox container name", error);
    });

    return { ...result, sandbox: { containerName: sandbox.id } };
  },
});
