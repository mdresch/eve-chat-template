// Env vars that live directly on the linked Vercel project and are kept in
// sync locally via `vercel env add` + `vercel env pull` (as opposed to
// DATABASE_URL/Upstash vars, which come from separate Marketplace
// integrations, are re-provisioned differently, and are already validated
// by lib/setup.ts's SetupStatus).
export const VERCEL_MANAGED_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "BETTER_AUTH_SECRET",
  "NEXT_PUBLIC_VERCEL_APP_CLIENT_ID",
  "VERCEL_APP_CLIENT_SECRET",
  "MODEL_KEY_ENCRYPTION_SECRET",
  "EXA_API_KEY",
  "CRON_SECRET",
] as const;

export function getMissingVercelManagedEnv(): string[] {
  return VERCEL_MANAGED_ENV_KEYS.filter((key) => !process.env[key]?.trim());
}

// True only for a local `pnpm dev` server, where shelling out to the Vercel
// CLI is safe and meaningful. Never true in a deployed Vercel environment:
// there's no local filesystem to write .env.vercel into, no `vercel` CLI on
// the machine, and a missing var there is a platform config problem, not
// something a browser button should try to fix.
export function canPullFromVercel(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.VERCEL;
}

// Called once from instrumentation.ts at server boot so a missing var shows
// up in the terminal immediately, before anyone hits a broken feature.
export function logBootEnvCheck(): void {
  const missing = getMissingVercelManagedEnv();

  if (missing.length === 0) {
    return;
  }

  const hint = canPullFromVercel()
    ? " Run `vercel env pull .env.vercel` (or use the banner in the chat UI) to fetch them."
    : "";

  console.warn(
    `[boot] Missing env var${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.${hint}`,
  );
}
