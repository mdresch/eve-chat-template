"use client";

import {
  ArrowUpRightIcon,
  BarChart3Icon,
  ChevronDownIcon,
  CircleCheckIcon,
  FileTextIcon,
  GitBranchIcon,
  LightbulbIcon,
  Link2Icon,
  MoreHorizontalIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ComposerFooterControls,
  ErrorToast,
  type AgentChatControllerStatus,
} from "@/app/_components/agent-chat";
import { useChatShell } from "@/app/_components/chat-shell-context";
import { ChatComposer } from "@/components/chat/composer";
import { TemplateFooterLinks } from "@/components/chat/template-footer-links";
import { getChatMessageLengthError } from "@/lib/chat/limits";
import { createProvisionalChatId, writePendingChatMessage } from "@/lib/chat/provisional-chat";
import type { SetupStatus } from "@/lib/chat/types";

const IDLE_CONTROLLER_STATUS: AgentChatControllerStatus = { isBusy: false, isDisabled: false, isEmpty: true };

export function HomeChatPage() {
  const { requestSignIn, setActiveChatId, setupStatus, viewer } = useChatShell();
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const setupReady = setupStatus.appReady;
  const pathname = usePathname();
  const router = useRouter();
  const toastError = clientError && dismissedError !== clientError ? clientError : null;

  useEffect(() => { setActiveChatId(null); }, [setActiveChatId]);
  useEffect(() => { if (pathname === "/") { submittingRef.current = false; setSubmitting(false); } }, [pathname]);
  useEffect(() => {
    if (!viewer) return;
    const restoredDraft = window.sessionStorage.getItem("eve-chat-draft");
    if (restoredDraft) { setDraft(restoredDraft); window.sessionStorage.removeItem("eve-chat-draft"); }
  }, [viewer]);
  useEffect(() => { setDismissedError(null); }, [clientError]);

  const handleSubmit = useCallback((text: string) => {
    const message = text.trim();
    if (!message || submittingRef.current) return;
    setClientError(null);
    const lengthError = getChatMessageLengthError(message);
    if (lengthError) { setClientError(lengthError); return; }
    if (!setupReady) { setClientError(getHomeComposerDisabledReason({ setupStatus, submitting }) ?? "Finish setup before chatting."); return; }
    if (!viewer) { requestSignIn(message); return; }
    submittingRef.current = true; setSubmitting(true); setDraft("");
    const provisionalChatId = createProvisionalChatId();
    if (!writePendingChatMessage(provisionalChatId, message)) {
      submittingRef.current = false; setSubmitting(false); setDraft(message); setClientError("Failed to start chat."); return;
    }
    setActiveChatId(provisionalChatId); router.push(`/chat/${provisionalChatId}`, { scroll: false });
  }, [requestSignIn, router, setActiveChatId, setupReady, setupStatus, submitting, viewer]);

  if (pathname !== "/") return null;
  const composerDisabledReason = getHomeComposerDisabledReason({ setupStatus, submitting });

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-14 md:pt-8">
      {toastError ? <ErrorToast message={toastError} onDismiss={() => setDismissedError(toastError)} /> : null}
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 pb-4 sm:px-6 sm:pb-6">
        <header className="mb-5 flex items-end justify-between border-b border-border/70 pb-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground"><SparklesIcon className="size-3.5" /> Intelligence canvas</div>
            <h1 className="text-2xl font-semibold tracking-tight">What are we working on?</h1>
            <p className="mt-1 text-sm text-muted-foreground">Turn a conversation into a living work product.</p>
          </div>
          <button className="hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium shadow-sm transition-colors hover:bg-muted sm:flex" type="button"><PlusIcon className="size-3.5" /> New workspace</button>
        </header>

        <main className="grid min-h-0 flex-1 gap-4 overflow-auto pb-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          <section className="space-y-4">
            <div className="rounded-lg border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <div className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-md bg-foreground text-background"><LightbulbIcon className="size-3.5" /></span><div><p className="text-sm font-semibold">Start with an objective</p><p className="text-xs text-muted-foreground">Your next message becomes a structured workspace.</p></div></div>
                <button aria-label="More options" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" type="button"><MoreHorizontalIcon className="size-4" /></button>
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-3">
                <CanvasPrompt icon={<BarChart3Icon className="size-4" />} title="Analyze a decision" text="Compare options with evidence, risks, and next actions." />
                <CanvasPrompt icon={<FileTextIcon className="size-4" />} title="Build a work product" text="Create a plan, report, model, or project artifact." />
                <CanvasPrompt icon={<GitBranchIcon className="size-4" />} title="Explore a path" text="Branch the conversation into focused investigations." />
              </div>
            </div>

            <div className="rounded-lg border border-dashed border-border bg-card/60 p-5 sm:p-6">
              <div className="mb-5 flex items-center justify-between"><div><p className="text-sm font-semibold">A message can become more</p><p className="mt-1 text-xs text-muted-foreground">Structured intelligence keeps important work connected.</p></div><span className="rounded-full border border-border px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Preview</span></div>
              <div className="grid gap-2 sm:grid-cols-2">
                <WorkspaceZone icon={<CircleCheckIcon className="size-3.5" />} label="Objective" value="What outcome are we trying to create?" />
                <WorkspaceZone icon={<Link2Icon className="size-3.5" />} label="Evidence" value="Sources, files, and live data" />
                <WorkspaceZone icon={<ShieldAlertIcon className="size-3.5" />} label="Alternatives" value="Compare paths before you commit" />
                <WorkspaceZone icon={<PlayIcon className="size-3.5" />} label="Actions" value="Simulate, export, or hand off" />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><UsersIcon className="size-4 text-muted-foreground" /><span className="text-sm font-semibold">Agent collaboration</span></div><span className="text-xs text-muted-foreground">Ready when you are</span></div>
              <div className="flex flex-wrap gap-2"><AgentChip name="Research" /><AgentChip name="Finance" /><AgentChip name="Risk" /><AgentChip name="Architecture" /></div>
            </div>
          </section>

          <aside className="hidden space-y-3 lg:block"><div className="rounded-lg border border-border bg-card p-4"><p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Workspace memory</p><MemoryRow title="Project Apollo" /><MemoryRow title="Business case v4" /><MemoryRow title="Institutional prospectus" /><button className="mt-2 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" type="button">View all <ArrowUpRightIcon className="size-3" /></button></div><div className="rounded-lg border border-border bg-card p-4"><div className="mb-3 flex items-center justify-between"><p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Canvas updates</p><RefreshCwIcon className="size-3.5 text-muted-foreground" /></div><p className="text-xs leading-relaxed text-muted-foreground">Your messages will retain context, connect related work, and evolve as new evidence arrives.</p></div></aside>
        </main>

        <div className="mx-auto w-full max-w-3xl shrink-0"><ChatComposer autoFocus disabled={!setupReady} disabledReason={composerDisabledReason} footerStart={<ComposerFooterControls setupStatus={setupStatus} />} isBusy={IDLE_CONTROLLER_STATUS.isBusy} isPreparing={submitting} onChange={setDraft} onStop={() => {}} onSubmit={handleSubmit} placeholder="Describe an objective, decision, or work product..." value={draft} /></div>
        <TemplateFooterLinks />
      </div>
    </div>
  );
}

function CanvasPrompt({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <button className="group rounded-md border border-border/80 p-3 text-left transition-colors hover:border-foreground/30 hover:bg-muted/40" type="button"><span className="mb-3 flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">{icon}</span><p className="text-xs font-semibold">{title}</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{text}</p></button>; }
function WorkspaceZone({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex gap-2 rounded-md bg-muted/45 p-3"><span className="mt-0.5 text-muted-foreground">{icon}</span><div><p className="text-[11px] font-semibold">{label}</p><p className="mt-1 text-[11px] text-muted-foreground">{value}</p></div></div>; }
function AgentChip({ name }: { name: string }) { return <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs"><span className="size-1.5 rounded-full bg-emerald-500" />{name} agent</span>; }
function MemoryRow({ title }: { title: string }) { return <button className="flex w-full items-center gap-2 border-b border-border/60 py-2 text-left text-xs last:border-0 hover:text-foreground" type="button"><Link2Icon className="size-3 text-muted-foreground" />{title}<ChevronDownIcon className="ml-auto size-3 -rotate-90 text-muted-foreground" /></button>; }
function getHomeComposerDisabledReason({ setupStatus, submitting }: { setupStatus: SetupStatus; submitting: boolean }) { if (!setupStatus.databaseConfigured) return "Connect Neon Postgres before chatting."; if (!setupStatus.databaseSchemaReady) return "Run database migrations: vercel env run -e production -- pnpm db:migrate."; if (!setupStatus.authReady) { const missing = setupStatus.missing.length ? ` Missing: ${setupStatus.missing.join(", ")}.` : ""; return `Finish auth setup before chatting.${missing}`; } if (!setupStatus.rateLimitReady) return "Provision Upstash Redis before chatting."; if (submitting) return "Preparing chat."; return undefined; }
