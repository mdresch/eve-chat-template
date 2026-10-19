"use client";

import { useMemo, useState } from "react";
import type { HandleMessageStreamEvent } from "eve/client";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ContainerIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react";
import { SandboxTelemetryBadge } from "@/components/chat/sandbox-telemetry-badge";

export type TaskStep = {
  id: string;
  title: string;
  detail?: string;
  status: "pending" | "in_progress" | "completed" | "failed";
};

function formatToolTitle(toolName: string, input?: Record<string, unknown>): { title: string; detail?: string } {
  switch (toolName) {
    case "bash": {
      const cmd = typeof input?.command === "string" ? input.command : "";
      return {
        title: "Running sandbox command",
        detail: cmd ? (cmd.length > 40 ? cmd.slice(0, 38) + "…" : cmd) : undefined,
      };
    }
    case "mxc_exec": {
      const cmd = typeof input?.command === "string" ? input.command : "";
      return {
        title: "Executing in Hyper-V VM",
        detail: cmd ? (cmd.length > 40 ? cmd.slice(0, 38) + "…" : cmd) : undefined,
      };
    }
    case "mxc_screenshot": {
      return {
        title: "Capturing Hyper-V screenshot",
        detail: "Guest desktop inspection",
      };
    }
    case "mxc_pool": {
      const action = typeof input?.action === "string" ? input.action : "";
      return {
        title: "Hyper-V pool management",
        detail: action || undefined,
      };
    }
    case "mxc_network": {
      const state = input?.state ? String(input.state) : "";
      return {
        title: "Hyper-V network toggle",
        detail: state || undefined,
      };
    }
    case "read_file": {
      const path = typeof input?.filePath === "string" ? input.filePath : "";
      return {
        title: "Reading file",
        detail: path || undefined,
      };
    }
    case "write_file": {
      const path = typeof input?.filePath === "string" ? input.filePath : "";
      return {
        title: "Writing file",
        detail: path || undefined,
      };
    }
    case "glob": {
      const pattern = typeof input?.pattern === "string" ? input.pattern : "";
      return {
        title: "Searching workspace files",
        detail: pattern || undefined,
      };
    }
    case "grep": {
      const pattern = typeof input?.pattern === "string" ? input.pattern : "";
      return {
        title: "Searching code (grep)",
        detail: pattern || undefined,
      };
    }
    case "web_search": {
      const query = typeof input?.query === "string" ? input.query : "";
      return {
        title: "Searching the web",
        detail: query ? `"${query}"` : undefined,
      };
    }
    case "web_fetch": {
      const url = typeof input?.url === "string" ? input.url : "";
      return {
        title: "Fetching URL",
        detail: url || undefined,
      };
    }
    default: {
      const cleanName = toolName
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return { title: cleanName };
    }
  }
}

export function deriveTaskSteps(events: readonly HandleMessageStreamEvent[]): TaskStep[] {
  // Find events in the latest turn
  let turnStartIndex = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === "turn.started") {
      turnStartIndex = i;
      break;
    }
  }

  const turnEvents = turnStartIndex >= 0 ? events.slice(turnStartIndex) : events;
  const steps: TaskStep[] = [];

  let hasReasoning = false;
  let hasActions = false;
  let hasTextAppended = false;
  const toolResults = new Map<string, { status: "completed" | "failed"; error?: string }>();

  // Collect action results first
  for (const event of turnEvents) {
    if (event.type === "action.result") {
      const data = event.data as unknown as {
        readonly callId?: string;
        readonly status?: "completed" | "failed";
        readonly error?: unknown;
      };
      if (data?.callId) {
        toolResults.set(data.callId, {
          status: data.status === "failed" || data.error ? "failed" : "completed",
          error: typeof data.error === "string" ? data.error : undefined,
        });
      }
    } else if (event.type === "reasoning.appended") {
      hasReasoning = true;
    } else if (event.type === "message.appended") {
      hasTextAppended = true;
    }
  }

  // 1. Analysis / Planning stage
  if (hasReasoning) {
    steps.push({
      id: "analysis",
      title: "Analyzing request & planning tasks",
      status: hasActions || hasTextAppended ? "completed" : "in_progress",
    });
  }

  // 2. Action / Tool stages
  for (const event of turnEvents) {
    if (event.type === "actions.requested") {
      hasActions = true;
      const data = event.data as unknown as {
        readonly actions?: readonly {
          readonly callId: string;
          readonly toolName: string;
          readonly input?: Record<string, unknown>;
        }[];
      };

      if (Array.isArray(data?.actions)) {
        for (const action of data.actions) {
          const res = toolResults.get(action.callId);
          const { title, detail } = formatToolTitle(action.toolName, action.input);

          steps.push({
            id: action.callId,
            title,
            detail: res?.error ? `Error: ${res.error}` : detail,
            status: res ? res.status : "in_progress",
          });
        }
      }
    }
  }

  // Fallback if no specific reasoning or actions yet
  if (steps.length === 0) {
    steps.push({
      id: "initial",
      title: "Analyzing request & planning tasks",
      status: "in_progress",
    });
  }

  // 4. Check for turn/step failure events
  let failureMessage: string | undefined;
  let isTurnFailed = false;
  for (const event of turnEvents) {
    if (event.type === "step.failed" || event.type === "turn.failed" || event.type === "session.failed") {
      isTurnFailed = true;
      const data = event.data as unknown as {
        message?: string;
        details?: { message?: string };
      };
      failureMessage = data?.details?.message || data?.message || "Execution failed";
    }
  }

  // 3. Final synthesis stage (only add if turn didn't fail)
  if (!isTurnFailed) {
    if (hasTextAppended) {
      steps.push({
        id: "synthesis",
        title: "Synthesizing response & insights",
        status: "in_progress",
      });
    } else if (steps.some((s) => s.status === "completed")) {
      steps.push({
        id: "synthesis",
        title: "Generating response",
        status: "pending",
      });
    }
  }

  if (failureMessage) {
    const inProgressStep = steps.find((s) => s.status === "in_progress") || steps[steps.length - 1];
    if (inProgressStep) {
      inProgressStep.status = "failed";
      inProgressStep.detail = failureMessage.length > 60 ? failureMessage.slice(0, 58) + "…" : failureMessage;
    }
  }

  return steps;
}

export function TaskProgressIndicator({
  events,
  containerName = null,
  isStreaming = false,
}: {
  readonly events: readonly HandleMessageStreamEvent[];
  readonly containerName?: string | null;
  readonly isStreaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const steps = useMemo(() => deriveTaskSteps(events), [events]);

  const hasFailed = steps.some((s) => s.status === "failed");
  const failedStep = steps.find((s) => s.status === "failed");
  const inProgressStep = steps.find((s) => s.status === "in_progress");
  const allCompleted = steps.length > 0 && steps.every((s) => s.status === "completed");

  const activeStep = inProgressStep || failedStep || steps[steps.length - 1];
  const completedCount = steps.filter((s) => s.status === "completed").length;
  const totalCount = steps.length;

  return (
    <div className="my-2 w-full max-w-xl rounded-lg border border-border/70 bg-muted/20 p-2.5 text-xs text-foreground shadow-xs">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2">
        <button
          className="flex items-center gap-2 font-medium text-foreground transition-colors hover:text-foreground/80"
          onClick={() => setExpanded((prev) => !prev)}
          type="button"
        >
          {expanded ? (
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="size-3.5 text-muted-foreground" />
          )}

          <span className="flex items-center gap-1.5">
            {hasFailed ? (
              <XIcon className="size-3.5 text-destructive" />
            ) : allCompleted && !isStreaming ? (
              <CheckIcon className="size-3.5 text-emerald-500" />
            ) : (
              <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
            )}
            <span className={hasFailed ? "truncate text-destructive" : "truncate"}>
              {hasFailed
                ? `Failed: ${failedStep?.title ?? "Execution error"}`
                : allCompleted && !isStreaming
                  ? "Tasks completed"
                  : activeStep?.title ?? "Processing..."}
            </span>
          </span>

          <span className="rounded-full bg-muted/60 px-1.5 py-0.2 font-mono text-[10px] text-muted-foreground">
            {completedCount}/{totalCount}
          </span>
        </button>

        {containerName ? (
          <div className="hidden sm:block">
            <SandboxTelemetryBadge
              compact
              containerName={containerName}
              isRunning={isStreaming}
            />
          </div>
        ) : null}
      </div>

      {/* Collapsible Steps list */}
      {expanded ? (
        <div className="mt-2.5 space-y-1.5 border-t border-border/40 pt-2 pl-1">
          {steps.map((step) => {
            const isInProgress = step.status === "in_progress";
            const isCompleted = step.status === "completed";
            const isFailed = step.status === "failed";
            const isPending = step.status === "pending";

            return (
              <div
                className={`flex items-center justify-between gap-2 py-0.5 transition-opacity ${
                  isPending ? "opacity-50" : "opacity-100"
                }`}
                key={step.id}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {isInProgress ? (
                      <Loader2Icon className="size-3 animate-spin text-foreground" />
                    ) : isCompleted ? (
                      <CheckIcon className="size-3.5 text-emerald-500" />
                    ) : isFailed ? (
                      <XIcon className="size-3.5 text-destructive" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                    )}
                  </span>

                  <span
                    className={`truncate font-normal ${
                      isInProgress
                        ? "font-medium text-foreground"
                        : isCompleted
                        ? "text-muted-foreground"
                        : isFailed
                        ? "text-destructive"
                        : "text-muted-foreground/70"
                    }`}
                  >
                    {step.title}
                  </span>
                </div>

                {step.detail ? (
                  <span
                    className={`shrink-0 truncate rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      isFailed
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted/50 text-muted-foreground"
                    }`}
                  >
                    {step.detail}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
