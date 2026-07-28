import { NextResponse } from "next/server";
import { stopIdleSandboxContainers } from "@/lib/sandbox/idle-cleanup";

const IDLE_THRESHOLD_MS = 30 * 60 * 1000;

// Triggered by an Upstash QStash schedule (Vercel Hobby plans cap Cron Jobs
// at once/day, too infrequent for idle cleanup). Stops the Docker sandbox
// container for any chat that's been idle past the threshold, so containers
// don't accumulate indefinitely. Never removes a container: eve reconnects
// to a stopped one by name on the chat's next turn, so this only reclaims
// idle compute without breaking resume.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.VERCEL) {
    // agent/sandbox.ts's defaultBackend() resolves to Vercel Sandbox here,
    // not Docker, so there's no container for this route to stop — Vercel
    // Sandbox expires idle sandboxes on its own.
    return NextResponse.json({ skipped: "not-a-docker-deployment" });
  }

  const result = await stopIdleSandboxContainers(new Date(Date.now() - IDLE_THRESHOLD_MS));

  return NextResponse.json(result);
}

function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET;

  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}
