"use client";

import { ClockIcon, ListOrderedIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function PromptQueueBadge({
  queue,
  onRemove,
  onClearAll,
}: {
  readonly queue: readonly string[];
  readonly onRemove: (index: number) => void;
  readonly onClearAll: () => void;
}) {
  if (queue.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 w-full rounded-xl border border-border/70 bg-card/95 p-2.5 text-xs text-foreground shadow-xs backdrop-blur-xs transition-all animate-in fade-in slide-in-from-bottom-2 duration-150">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-border/40">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <ListOrderedIcon className="size-3.5 text-muted-foreground" />
          <span>Prompt Queue</span>
          <span className="rounded-full bg-muted/80 px-1.5 py-0.2 font-mono text-[10px] text-muted-foreground">
            {queue.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-muted-foreground sm:inline-block">
            Sends automatically in sequence (FIFO)
          </span>
          {queue.length > 1 ? (
            <Button
              className="h-5 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={onClearAll}
              size="xs"
              type="button"
              variant="ghost"
            >
              Clear all
            </Button>
          ) : null}
        </div>
      </div>

      {/* FIFO Prompt List */}
      <div className="mt-1.5 space-y-1 max-h-28 overflow-y-auto pr-0.5">
        {queue.map((prompt, index) => (
          <div
            className="group flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1 transition-colors hover:bg-muted/50"
            key={`${index}:${prompt.slice(0, 20)}`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                {index === 0 ? "Next:" : `#${index + 1}`}
              </span>
              <span className="truncate text-foreground/90 font-normal">
                {prompt}
              </span>
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label="Remove prompt from queue"
                  className="size-4 shrink-0 rounded-sm text-muted-foreground opacity-60 hover:opacity-100 hover:text-destructive transition-opacity flex items-center justify-center cursor-pointer"
                  onClick={() => onRemove(index)}
                  type="button"
                >
                  <XIcon className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Remove from queue</TooltipContent>
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  );
}
