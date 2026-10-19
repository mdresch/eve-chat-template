import { defineTool } from "eve/tools";
import { bash } from "eve/tools/defaults";
import { recordChatSandboxContainer } from "@/lib/db/queries";
import { mxcExecCommand, resolveMxcConfig } from "@/lib/mxc/client";

let hypervSuspendedUntil = 0;

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
      Date.now() > hypervSuspendedUntil &&
      (sandboxPref.activeSandbox === "hyperv" || sandboxPref.activeSandbox === "mxc")
    ) {
      try {
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

        if (
          mxcRes.exitCode !== 0 &&
          (mxcRes.stderr.includes("PSSessionStateBroken") ||
            mxcRes.stderr.includes("not in running state") ||
            mxcRes.stderr.includes("backend_error"))
        ) {
          hypervSuspendedUntil = Date.now() + 60_000;
          console.warn(
            "MXC / Hyper-V guest remoting is broken or suspended, falling back to local Docker sandbox (cached for 60s):",
            mxcRes.stderr,
          );
        } else {
          return {
            exitCode: mxcRes.exitCode,
            stdout: mxcRes.stdout,
            stderr: mxcRes.stderr,
            sandbox: { containerName: mxcRes.sandboxId },
          };
        }
      } catch (error) {
        hypervSuspendedUntil = Date.now() + 60_000;
        console.warn(
          "MXC / Hyper-V command execution failed, falling back to local Docker sandbox (cached for 60s):",
          error,
        );
      }
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
