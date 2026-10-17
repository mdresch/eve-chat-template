import { defineTool } from "eve/tools";
import { z } from "zod";
import { mxcCaptureScreenshot } from "@/lib/mxc/client";

export default defineTool({
  description:
    "Capture a real-time screenshot of the Hyper-V guest desktop buffer via synthetic display controller WMI API. " +
    "Returns a base64 PNG data URL that visually renders the guest OS desktop (login screens, GUI apps, installer wizards, web apps) in chat.",
  inputSchema: z.object({
    sandbox_id: z
      .string()
      .optional()
      .describe(
        "Target sandbox ID (e.g. 'hv:e23b86b8'). If omitted, captures the active default VM."
      ),
  }),
  async execute({ sandbox_id }) {
    const shot = await mxcCaptureScreenshot(sandbox_id);
    return {
      sandboxId: shot.sandboxId,
      imagePath: shot.imagePath,
      dataUrl: shot.dataUrl,
      width: shot.width,
      height: shot.height,
      preview: shot.dataUrl
        ? `![Guest Desktop (${shot.sandboxId})](${shot.dataUrl})`
        : `Captured ${shot.width}x${shot.height} screenshot on Hyper-V host at ${shot.imagePath}`,
    };
  },
});

