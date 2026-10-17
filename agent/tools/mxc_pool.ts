import { defineTool } from "eve/tools";
import { z } from "zod";
import { recordChatSandboxContainer } from "@/lib/db/queries";
import { mxcPoolLease, mxcPoolRelease, mxcPoolStatus } from "@/lib/mxc/client";

export default defineTool({
  description:
    "Manage the MXC Hyper-V warm standby pool: check pool depth, lease a pre-warmed sub-300ms " +
    "Windows Server 2025 VM, or release and recycle a sandbox back to clean baseline snapshot.",
  inputSchema: z.object({
    action: z
      .enum(["status", "lease", "release"])
      .describe(
        "'status' to view pool depth & members, 'lease' to checkout a warm standby VM, or 'release' to restore to baseline and return to pool."
      ),
    sandbox_id: z
      .string()
      .optional()
      .describe("Sandbox ID to release (required when action is 'release')."),
    holder: z
      .string()
      .optional()
      .describe("Lease holder identifier tag (optional when action is 'lease')."),
  }),
  async execute({ action, sandbox_id, holder }, ctx) {
    if (action === "status") {
      const status = await mxcPoolStatus();
      return {
        action: "status",
        targetSize: status.target_size,
        totalMembers: status.total_members,
        readyCount: status.ready_count,
        leasedCount: status.leased_count,
        members: status.members.map((m) => ({
          sandboxId: m.sandbox_id,
          vmName: m.vm_name,
          status: m.status,
          leasedTo: m.leased_to,
        })),
      };
    }

    if (action === "lease") {
      const leasedId = await mxcPoolLease(holder || "eve-user");
      void recordChatSandboxContainer({
        containerName: leasedId,
        sessionId: ctx.session.id,
      }).catch((error) => {
        console.warn("Failed to record leased MXC sandbox container name", error);
      });
      return {
        action: "lease",
        leasedSandboxId: leasedId,
        message: `Successfully leased warm standby sandbox ${leasedId} in <300ms.`,
        sandbox: { containerName: leasedId },
      };
    }

    if (action === "release") {
      if (!sandbox_id) {
        throw new Error("sandbox_id is required when releasing back to the pool.");
      }
      await mxcPoolRelease(sandbox_id);
      return {
        action: "release",
        releasedSandboxId: sandbox_id,
        message: `Successfully rolled back ${sandbox_id} to clean baseline snapshot and recycled into ready queue.`,
      };
    }

    throw new Error(`Unsupported pool action: ${action}`);
  },
});

