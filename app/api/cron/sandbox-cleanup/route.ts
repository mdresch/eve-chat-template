import { NextResponse } from "next/server";
import { stopIdleSandboxContainers } from "@/lib/sandbox/idle-cleanup";

const IDLE_THRESHOLD_MS = 30 * 60 * 1000;

// Triggered by Vercel Cron (see vercel.json). Stops the Docker sandbox
// container for any chat that's been idle past the threshold, so containers
// don't accumulate indefinitely. Never removes a container: eve reconnects
// to a stopped one by name on the chat's next turn, so this only reclaims
// idle compute without breaking resume.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await stopIdleSandboxContainers(new Date(Date.now() - IDLE_THRESHOLD_MS));

  return NextResponse.json(result);
}

function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET;

  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}
