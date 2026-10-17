import type { EveDynamicToolPart, EveMessage, EveMessagePart } from "eve/react";

const SANDBOX_TOOL_NAMES = new Set(["bash", "mxc_exec", "mxc_pool", "mxc_screenshot", "mxc_network"]);

// agent/tools/bash.ts and agent/tools/mxc_*.ts return the sandbox container/VM
// name on every call. Scanning backwards for the most recent one is enough to
// know which Docker container or Hyper-V sandbox the current chat's workspace
// lives in — no extra persistence needed, since it rides along on the event
// log the app already stores per chat.
export function findLatestSandboxContainerName(
  messages: readonly EveMessage[],
): string | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const parts = messages[messageIndex]?.parts ?? [];

    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const containerName = readContainerName(parts[partIndex]);

      if (containerName) {
        return containerName;
      }
    }
  }

  return null;
}

export function findSandboxContainerNameFromEvents(
  events: readonly { type?: string; data?: unknown }[],
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === "action.result") {
      const data = event.data as
        | {
            output?: {
              sandbox?: { containerName?: unknown };
              sandboxId?: unknown;
              leasedSandboxId?: unknown;
            };
          }
        | undefined;
      const containerName =
        data?.output?.sandbox?.containerName ??
        data?.output?.sandboxId ??
        data?.output?.leasedSandboxId;
      if (typeof containerName === "string" && containerName.length > 0) {
        return containerName;
      }
    }
  }

  return null;
}

function readContainerName(part: EveMessagePart | undefined) {
  if (!part || part.type !== "dynamic-tool" || part.state !== "output-available") {
    return null;
  }

  if (!isSandboxTool(part)) {
    return null;
  }

  const output = part.output as
    | {
        sandbox?: { containerName?: unknown };
        sandboxId?: unknown;
        leasedSandboxId?: unknown;
      }
    | undefined;
  const containerName =
    output?.sandbox?.containerName ?? output?.sandboxId ?? output?.leasedSandboxId;

  return typeof containerName === "string" && containerName.length > 0 ? containerName : null;
}

function isSandboxTool(part: EveDynamicToolPart) {
  const name = part.toolMetadata?.eve?.name ?? part.toolName;

  return SANDBOX_TOOL_NAMES.has(name);
}
