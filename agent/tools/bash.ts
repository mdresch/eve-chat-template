import { defineTool } from "eve/tools";
import { bash } from "eve/tools/defaults";
import { recordChatSandboxContainer } from "@/lib/db/queries";
import { mxcExecCommand, resolveMxcConfig } from "@/lib/mxc/client";

// Wraps eve's framework-default `bash` tool (already auto-available once
// agent/sandbox.ts exists) to respect the user's active sandbox runtime
// preference on /settings ("docker", "vercel-sandbox", "mxc", "hyperv") and
// report the active container or Hyper-V VM identifier back to the chat UI.
export default defineTool({
  ...bash,
  async execute(input, ctx) {
    const sandboxPref = await resolveMxcConfig();
    const commandText =
      typeof (input as { command?: unknown })?.command === "string"
        ? (input as { command: string }).command
        : "";

    if (
      commandText &&
      (sandboxPref.activeSandbox === "hyperv" || sandboxPref.activeSandbox === "mxc")
    ) {
      const mxcRes = await mxcExecCommand(commandText, {
        sandboxId: sandboxPref.defaultSandboxId ?? undefined,
      });

      if (mxcRes.sandboxId) {
        void recordChatSandboxContainer({
          containerName: mxcRes.sandboxId,
          sessionId: ctx.session.id,
        }).catch((error) => {
          console.warn("Failed to record MXC sandbox container name", error);
        });
      }

      return {
        exitCode: mxcRes.exitCode,
        stdout: mxcRes.stdout,
        stderr: mxcRes.stderr,
        sandbox: { containerName: mxcRes.sandboxId },
      };
    }

    const result = (await bash.execute(input, ctx)) as Record<string, unknown>;

    if (process.env.VERCEL || sandboxPref.activeSandbox === "vercel-sandbox") {
      return result;
    }

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
