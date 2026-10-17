import { defineTool } from "eve/tools";
import { z } from "zod";
import { mxcSetNetwork } from "@/lib/mxc/client";

export default defineTool({
  description:
    "Hot-plug or airgap network connectivity for the Hyper-V sandbox VM (connects to Default Switch for package installation or disconnects for strict zero-exfiltration airgap isolation).",
  inputSchema: z.object({
    enabled: z
      .boolean()
      .describe(
        "True to connect network adapter to Default Switch (internet access); False to disconnect for strict airgap isolation."
      ),
    sandbox_id: z
      .string()
      .optional()
      .describe(
        "Target sandbox ID (e.g. 'hv:e23b86b8'). If omitted, defaults to active VM."
      ),
  }),
  async execute({ enabled, sandbox_id }) {
    const result = await mxcSetNetwork(sandbox_id, enabled);
    return {
      sandboxId: result.sandboxId,
      networkConnected: result.connected,
      mode: result.connected ? "NAT Connected (Internet Enabled)" : "Airgapped (Isolated)",
    };
  },
});

