import { NextResponse } from "next/server";
import type { HandleMessageStreamEvent, SessionState } from "eve/client";
import { skipChatAuthorization } from "@/lib/db/queries";
import { getServerViewer } from "@/lib/session";

// Plain route handler, not a Server Action — see the snapshot route handler
// for why: avoids the implicit page re-render a Server Action bound to
// /chat/[id] would trigger on every call.
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
    const result = await skipChatAuthorization({
      chatId,
      events: body.events ?? [],
      session: body.session,
      userId: viewer.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to skip authorization.";
    const status = message === "Chat not found." ? 404 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
