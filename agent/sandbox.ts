import { defaultBackend, defineSandbox } from "eve/sandbox";
import { recordChatSandboxContainer } from "@/lib/db/queries";

// defaultBackend() picks Vercel Sandbox when deployed on Vercel
// (`process.env.VERCEL` is set — Docker can't run in Vercel's build or
// runtime environments) and Docker otherwise, so local dev and this app's
// own Vercel deployment both get a working sandbox.
export default defineSandbox({
  backend: defaultBackend(),
  // Record the container name as soon as the sandbox opens, not only when
  // the model happens to call bash (agent/tools/bash.ts does the same
  // recording there, redundantly, for sessions that reuse an existing
  // sandbox without going through onSession again). Only meaningful on the
  // Docker path: Vercel Sandbox has no attachable local container, so
  // there's nothing useful to record there.
  async onSession({ use, ctx }) {
    const sandbox = await use();

    if (process.env.VERCEL) {
      return;
    }

    void recordChatSandboxContainer({
      containerName: sandbox.id,
      sessionId: ctx.session.id,
    }).catch((error) => {
      console.warn("Failed to record sandbox container name", error);
    });
  },
});
