"use client";

import { useEffect, useState } from "react";
import { ContainerIcon, CopyCheckIcon, CopyIcon, ActivityIcon } from "lucide-react";
import type { SandboxTelemetry } from "@/app/api/sandbox/telemetry/route";

export function SandboxTelemetryBadge({
  containerName,
  isRunning = false,
  compact = false,
  autoDiscover = true,
}: {
  readonly containerName?: string | null;
  readonly isRunning?: boolean;
  readonly compact?: boolean;
  readonly autoDiscover?: boolean;
}) {
  const [telemetry, setTelemetry] = useState<SandboxTelemetry | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  useEffect(() => {
    const target = containerName || (autoDiscover ? "auto" : null);
    if (!target) {
      setTelemetry(null);
      return;
    }

    let isMounted = true;

    async function fetchTelemetry() {
      try {
        const res = await fetch(
          `/api/sandbox/telemetry?containerName=${encodeURIComponent(target!)}`,
        );
        if (res.ok) {
          const data = (await res.json()) as SandboxTelemetry;
          if (isMounted && data.available) {
            setTelemetry(data);
          }
        }
      } catch {
        // Ignore network hiccups
      }
    }

    void fetchTelemetry();

    // Poll every 3s while agent is running/streaming
    if (isRunning) {
      const interval = window.setInterval(fetchTelemetry, 3000);
      return () => {
        isMounted = false;
        window.clearInterval(interval);
      };
    }

    return () => {
      isMounted = false;
    };
  }, [containerName, autoDiscover, isRunning]);

  const effectiveContainerName = containerName ?? telemetry?.name ?? telemetry?.containerId ?? null;
  if (!effectiveContainerName || !telemetry?.available) {
    return null;
  }

  const shortName =
    effectiveContainerName.length > 16
      ? effectiveContainerName.slice(0, 14) + "…"
      : effectiveContainerName;
  const cpuText = telemetry?.available && telemetry.cpu ? telemetry.cpu : null;
  const memUsageText =
    telemetry?.available && telemetry.memory ? telemetry.memory.split("/")[0]?.trim() : null;

  return (
    <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
      <button
        className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 transition-colors hover:text-foreground hover:bg-muted/70"
        onClick={() => {
          void navigator.clipboard.writeText(effectiveContainerName).then(() => setCopied(true));
        }}
        title={`Docker sandbox container: ${effectiveContainerName}\nClick to copy name`}
        type="button"
      >
        <ContainerIcon className="size-3 text-muted-foreground" />
        <span className="max-w-32 truncate">{shortName}</span>
        {copied ? (
          <CopyCheckIcon className="size-3 text-emerald-500" />
        ) : (
          <CopyIcon className="size-3 text-muted-foreground/70" />
        )}
      </button>

      {telemetry?.available && !compact ? (
        <div
          className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground"
          title={`Docker Telemetry:\nCPU: ${telemetry.cpu ?? "0%"}\nMemory: ${telemetry.memory ?? "N/A"}\nNet I/O: ${telemetry.netIO ?? "N/A"}\nPIDs: ${telemetry.pids ?? "N/A"}`}
        >
          <span className="flex items-center gap-1">
            <span
              className={`size-1.5 rounded-full ${
                isRunning ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/50"
              }`}
            />
            <span>{isRunning ? "active" : "ready"}</span>
          </span>
          {cpuText ? <span>CPU {cpuText}</span> : null}
          {memUsageText ? <span>RAM {memUsageText}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
