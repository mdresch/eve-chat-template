"use server";

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { canPullFromVercel, getMissingVercelManagedEnv } from "@/lib/env-check";

const execAsync = promisify(exec);

export async function getVercelEnvStatusAction() {
  return {
    canPull: canPullFromVercel(),
    missing: getMissingVercelManagedEnv(),
  };
}

// Pulls the linked Vercel project's env vars into .env.vercel — deliberately
// not .env.local, so this never overwrites values edited or restored by hand
// locally (e.g. connector env vars that aren't in the Vercel project). Merge
// what you need from .env.vercel yourself, then restart the dev server: the
// running process's env was read at boot and won't pick up file changes.
export async function pullVercelEnvAction(): Promise<{ readonly output: string }> {
  if (!canPullFromVercel()) {
    throw new Error("Pulling Vercel env vars is only available in local development.");
  }

  try {
    const { stdout, stderr } = await execAsync("vercel env pull .env.vercel", {
      cwd: process.cwd(),
      timeout: 60_000,
    });

    return { output: (stdout || stderr).trim() };
  } catch (error) {
    const stderr = (error as { stderr?: string } | undefined)?.stderr?.trim();
    throw new Error(stderr || (error instanceof Error ? error.message : "vercel env pull failed."));
  }
}
