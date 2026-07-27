import { NextResponse } from "next/server";
import type { HandleMessageStreamEvent } from "eve/client";
import { appendChatEvents } from "@/lib/db/queries";
import { getServerViewer } from "@/lib/session";

// Plain route handler, not a Server Action: a Server Action bound to the
// /chat/[id] page implicitly re-renders that page's Server Components
// (including the full chat event history) after every call, and its request
// body is capped at 1 MB. Streaming a turn calls this endpoint many times per
// message, so both of those costs would otherwise scale with total chat size.
const MAX_EVENTS_PER_REQUEST = 200;

type ChatEventBatchEntry = {
  readonly event: HandleMessageStreamEvent;
  readonly eventIndex: number;
};

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ readonly id: string }> },
) {
  const viewer = await getServerViewer();

  if (!viewer) {
    return NextResponse.json({ error: "Sign in with Vercel to continue." }, { status: 401 });
  }

  const { id: chatId } = await params;
  const body = (await request.json().catch(() => null)) as {
    readonly events?: readonly ChatEventBatchEntry[];
  } | null;
  const events = body?.events ?? [];

  if (events.length === 0) {
    return NextResponse.json({ ok: true });
  }

  if (events.length > MAX_EVENTS_PER_REQUEST) {
    return NextResponse.json({ error: "Too many events in one request." }, { status: 400 });
  }

  try {
    await appendChatEvents({ chatId, events, userId: viewer.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save chat events.";
    const status = message === "Chat not found." ? 404 : 500;

    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true });
}
