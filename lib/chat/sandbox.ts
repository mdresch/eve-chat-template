import type { EveDynamicToolPart, EveMessage, EveMessagePart } from "eve/react";

const SANDBOX_TOOL_NAME = "bash";

// agent/tools/bash.ts wraps eve's framework-default bash tool to also return
// its sandbox container name on every call. Scanning backwards for the most
// recent one is enough to know which Docker container the current chat's
// workspace lives in — no extra persistence needed, since it rides along on
// the event log the app already stores per chat.
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

function readContainerName(part: EveMessagePart | undefined) {
  if (!part || part.type !== "dynamic-tool" || part.state !== "output-available") {
    return null;
  }

  if (!isSandboxTool(part)) {
    return null;
  }

  const output = part.output as { sandbox?: { containerName?: unknown } } | undefined;
  const containerName = output?.sandbox?.containerName;

  return typeof containerName === "string" && containerName.length > 0 ? containerName : null;
}

function isSandboxTool(part: EveDynamicToolPart) {
  const name = part.toolMetadata?.eve?.name ?? part.toolName;

  return name === SANDBOX_TOOL_NAME;
}
