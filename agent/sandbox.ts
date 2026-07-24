import { defineSandbox } from "eve/sandbox";
import { docker } from "eve/sandbox/docker";

// Pinned to Docker so the agent's sandbox stays independent of Vercel: it
// must keep working the same way locally and in this app's own deployment,
// regardless of whether `process.env.VERCEL` is set.
export default defineSandbox({
  backend: docker(),
});
