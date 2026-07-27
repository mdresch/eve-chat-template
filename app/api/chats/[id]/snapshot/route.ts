import { NextResponse } from "next/server";
import type { HandleMessageStreamEvent, SessionState } from "eve/client";
import { saveChatSnapshot } from "@/lib/db/queries";
import { getServerViewer } from "@/lib/session";

// Plain route handler, not a Server Action: this carries the chat's full
// event history (used to reconcile the DB at turn end / after a resume), and
// a Server Action bound to the /chat/[id] page both re-renders that page's
// Server Components after every call and caps its request body at 1 MB —
// both scale badly once a chat has hundreds of events.
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
    readonly events?: readonly HandleMessageStreamEvent[];
    readonly session?: SessionState;
  } | null;

  if (!body?.session) {
    return NextResponse.json({ error: "Missing session state." }, { status: 400 });
  }

  try {
    await saveChatSnapshot({
      chatId,
      events: body.events ?? [],
      session: body.session,
      userId: viewer.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save chat snapshot.";
    const status = message === "Chat not found." ? 404 : 500;

    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true });
}
