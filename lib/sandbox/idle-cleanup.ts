import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listIdleChatsWithSandboxSession } from "@/lib/db/queries";
import { mxcPoolRelease } from "@/lib/mxc/client";

const execFileAsync = promisify(execFile);

// Matches the label eve's Docker sandbox backend already stamps on every
// session container (see node_modules/eve/dist/src/execution/sandbox/bindings/docker-container.js).
const SANDBOX_SESSION_ID_LABEL = "eve.sandbox.tag.sessionId";

export interface IdleSandboxCleanupResult {
  readonly checkedChats: number;
  readonly errors: readonly { readonly chatId: string; readonly error: string }[];
  readonly stoppedContainers: readonly string[];
}

// Stops (never removes) the Docker container backing an idle chat's sandbox,
// or recycles an idle MXC Hyper-V sandbox back to clean baseline snapshot.
// eve's own backend keys session containers by a name derived from the eve
// sessionId and reconnects to a stopped container by that name on the next
// turn (`docker start`), so stopping here is safe: the workspace filesystem
// and the ability to resume are both preserved, only the idle compute isn't.
export async function stopIdleSandboxContainers(
  idleBefore: Date,
): Promise<IdleSandboxCleanupResult> {
  const idleChats = await listIdleChatsWithSandboxSession(idleBefore);
  const stoppedContainers: string[] = [];
  const errors: { chatId: string; error: string }[] = [];

  for (const { chatId, sessionId, sandboxContainerName } of idleChats) {
    try {
      // 1. If this is an MXC Hyper-V sandbox, recycle it back to clean baseline
      if (sandboxContainerName && sandboxContainerName.startsWith("hv:")) {
        await mxcPoolRelease(sandboxContainerName);
        stoppedContainers.push(sandboxContainerName);
        continue;
      }

      // 2. Otherwise handle standard Docker sandbox container
      const containerName = await findRunningSandboxContainerName(sessionId);

      if (containerName) {
        await execFileAsync("docker", ["stop", "-t", "0", containerName]);
        stoppedContainers.push(containerName);
      }
    } catch (error) {
      errors.push({ chatId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { checkedChats: idleChats.length, errors, stoppedContainers };
}

async function findRunningSandboxContainerName(sessionId: string) {
  const { stdout } = await execFileAsync("docker", [
    "ps",
    "--filter",
    `label=${SANDBOX_SESSION_ID_LABEL}=${sessionId}`,
    "--filter",
    "status=running",
    "--format",
    "{{.Names}}",
  ]);

  const name = stdout.trim().split("\n")[0]?.trim();

  return name && name.length > 0 ? name : null;
}
