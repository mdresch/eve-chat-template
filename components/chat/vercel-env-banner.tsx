"use client";

import { Loader2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { pullVercelEnvAction } from "@/app/actions/vercel-env";
import { Button } from "@/components/ui/button";

export function VercelEnvBanner({
  canPull,
  missing,
}: {
  readonly canPull: boolean;
  readonly missing: readonly string[];
}) {
  const [dismissed, setDismissed] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [result, setResult] = useState<{ readonly ok: boolean; readonly message: string } | null>(
    null,
  );

  if (dismissed || !canPull || missing.length === 0) {
    return null;
  }

  async function handlePull() {
    setPulling(true);
    setResult(null);

    try {
      const { output } = await pullVercelEnvAction();

      setResult({
        message:
          "Pulled into .env.vercel. Merge the values you need into .env.local, then restart the dev server — the running process already read its env at boot." +
          (output ? ` (${output})` : ""),
        ok: true,
      });
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : "Pull failed.", ok: false });
    } finally {
      setPulling(false);
    }
  }

  return (
    <div className="mx-2 mt-14 flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm md:mx-3 md:mt-8">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">Missing env vars</p>
          <p className="mt-0.5 break-words text-muted-foreground">
            Not set locally: <span className="font-mono">{missing.join(", ")}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button disabled={pulling} onClick={() => void handlePull()} size="sm" variant="outline">
            {pulling ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            Run vercel env pull .env.vercel
          </Button>
          <Button
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>
      {result ? (
        <p className={result.ok ? "text-emerald-600" : "text-destructive"}>{result.message}</p>
      ) : null}
    </div>
  );
}
