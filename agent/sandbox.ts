import { defineSandbox } from "eve/sandbox";
import { docker } from "eve/sandbox/docker";
import { recordChatSandboxContainer } from "@/lib/db/queries";

// Pinned to Docker so the agent's sandbox stays independent of Vercel: it
// must keep working the same way locally and in this app's own deployment,
// regardless of whether `process.env.VERCEL` is set.
export default defineSandbox({
  backend: docker(),
  // Record the container name as soon as the sandbox opens, not only when
  // the model happens to call bash (agent/tools/bash.ts does the same
  // recording there, redundantly, for sessions that reuse an existing
  // sandbox without going through onSession again).
  async onSession({ use, ctx }) {
    const sandbox = await use();

    void recordChatSandboxContainer({
      containerName: sandbox.id,
      sessionId: ctx.session.id,
    }).catch((error) => {
      console.warn("Failed to record sandbox container name", error);
    });
  },
});
