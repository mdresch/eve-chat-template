import { defineTool } from "eve/tools";
import { z } from "zod";
import { recordChatSandboxContainer } from "@/lib/db/queries";
import { mxcExecCommand } from "@/lib/mxc/client";

export default defineTool({
  description:
    "Execute a command inside the isolated MXC Hyper-V Windows Server 2025 guest sandbox via PowerShell Direct. " +
    "Supports optional disposable mode (auto-rollback on failure). If no sandbox_id is specified, automatically leases " +
    "a pre-warmed VM from the warm standby pool in <300ms.",
  inputSchema: z.object({
    command: z
      .string()
      .min(1)
      .describe(
        "The command to run inside the Windows Server 2025 guest VM (e.g., 'powershell -Command \"Get-Process\"', 'cargo test', 'dir C:\\')"
      ),
    sandbox_id: z
      .string()
      .optional()
      .describe(
        "Target sandbox ID (e.g. 'hv:e23b86b8'). If omitted, automatically leases a warm standby instance from the pool."
      ),
    disposable: z
      .boolean()
      .optional()
      .describe(
        "If true, takes an ephemeral checkpoint before executing and automatically rolls back if the command fails."
      ),
  }),
  async execute({ command, sandbox_id, disposable }, ctx) {
    const result = await mxcExecCommand(command, {
      sandboxId: sandbox_id,
      disposable,
    });

    if (result.sandboxId) {
      void recordChatSandboxContainer({
        containerName: result.sandboxId,
        sessionId: ctx.session.id,
      }).catch((error) => {
        console.warn("Failed to record MXC sandbox container name", error);
      });
    }

    return {
      sandboxId: result.sandboxId,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      sandbox: { containerName: result.sandboxId },
    };
  },
});
