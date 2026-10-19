import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getDefaultDevSandboxPreference,
  type UserSandboxPreferenceSummary,
} from "@/lib/db/queries";
import type {
  MxcExecOptions,
  MxcExecResult,
  MxcPoolStatus,
  MxcScreenshotResult,
} from "./types";

const execFileAsync = promisify(execFile);

let cachedPref: { value: UserSandboxPreferenceSummary; expiresAt: number } | null = null;
let cachedDiscoveredFallbackId: string | null = null;

export function invalidateMxcConfigCache(): void {
  cachedPref = null;
}

export async function resolveMxcConfig(): Promise<UserSandboxPreferenceSummary> {
  if (cachedPref && Date.now() < cachedPref.expiresAt) {
    return cachedPref.value;
  }
  const value = await getDefaultDevSandboxPreference();
  cachedPref = { value, expiresAt: Date.now() + 5000 };
  return value;
}

// ===========================================================================
// Configuration & Path Resolution
// ===========================================================================

export function getMxcRepoRoot(repoOverride?: string | null): string {
  const configured = repoOverride?.trim() || process.env.MXC_REPO_ROOT?.trim();
  if (configured && existsSync(configured)) {
    return configured;
  }
  const candidates = [
    "C:\\Users\\MennoDrescher\\source\\repos\\mxc",
    "D:\\Source\\repos\\mxc",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return process.cwd();
}

export function getRemoteMxcRepoRoot(repoOverride?: string | null): string {
  return (
    repoOverride?.trim() ||
    process.env.MXC_REMOTE_REPO_ROOT?.trim() ||
    process.env.MXC_REPO_ROOT?.trim() ||
    "C:\\Users\\MennoDrescher\\source\\repos\\mxc"
  );
}

export function getRemoteMxcExecPath(repoOverride?: string | null): string {
  if (process.env.MXC_REMOTE_EXEC_PATH?.trim()) {
    return process.env.MXC_REMOTE_EXEC_PATH.trim();
  }
  const remoteRepo = getRemoteMxcRepoRoot(repoOverride).replace(/[\\/]+$/, "");
  return `${remoteRepo}\\src\\target\\debug\\wxc-exec.exe`;
}

export function getMxcExecPath(repoOverride?: string | null): string {
  if (process.env.MXC_EXEC_PATH && existsSync(process.env.MXC_EXEC_PATH)) {
    return process.env.MXC_EXEC_PATH;
  }
  const repo = getMxcRepoRoot(repoOverride);
  const debugPath = join(repo, "src", "target", "debug", "wxc-exec.exe");
  if (existsSync(debugPath)) {
    return debugPath;
  }
  const releasePath = join(repo, "target", "release", "wxc.exe");
  if (existsSync(releasePath)) {
    return releasePath;
  }
  return debugPath;
}

export function getExecTemplatePath(repoOverride?: string | null): string {
  const repo = getMxcRepoRoot(repoOverride);
  const templatePath = join(repo, "exec.json");
  if (existsSync(templatePath)) {
    return templatePath;
  }
  const fallback = join(tmpdir(), "mxc-exec-template.json");
  if (!existsSync(fallback)) {
    writeFileSync(
      fallback,
      JSON.stringify(
        {
          version: "1.1.0-alpha",
          process: { commandLine: "cmd.exe /c echo ok" },
        },
        null,
        2,
      ),
    );
  }
  return fallback;
}

// ===========================================================================
// Tri-Mode Dispatcher Layer
// ===========================================================================

/**
 * Execute CLI commands across all 3 modes:
 * - Mode 1: FastMCP HTTP/SSE (if mcpUrl / MXC_MCP_URL is defined)
 * - Mode 2: Remote execution over SSH (if remoteHost / MXC_REMOTE_HOST is defined)
 * - Mode 3: Local execution on Hyper-V host
 */
export async function runMxcCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const cfg = await resolveMxcConfig();
  const remoteHost = cfg.remoteHost || process.env.MXC_REMOTE_HOST;
  if (remoteHost) {
    const remoteExe = getRemoteMxcExecPath(cfg.repoRoot);
    const quotedArgs = args
      .map((a) => (a.includes(" ") ? `"${a.replace(/"/g, '`"')}"` : a))
      .join(" ");
    const remoteCmd = `& "${remoteExe}" ${quotedArgs}`;

    return await execFileAsync("ssh", [remoteHost, remoteCmd]);
  }

  // Mode 3: Direct local execution
  const exe = getMxcExecPath(cfg.repoRoot);
  return await execFileAsync(exe, args);
}

/**
 * Runs a PowerShell command against the host (local or remote SSH).
 */
export async function runHostPowershell(psScript: string): Promise<{ stdout: string; stderr: string }> {
  const cfg = await resolveMxcConfig();
  const remoteHost = cfg.remoteHost || process.env.MXC_REMOTE_HOST;

  if (remoteHost) {
    const escaped = psScript.replace(/"/g, '\\"').replace(/\$/g, "`$");
    const sshCmd = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${escaped}"`;
    return await execFileAsync("ssh", [remoteHost, sshCmd]);
  }

  return await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    psScript,
  ]);
}

interface FastMcpRawResult {
  readonly rawText: string;
  readonly parsedJson: Record<string, any> | null;
  readonly rawResponse: Record<string, any>;
}

/**
 * Mode 1: Optional FastMCP HTTP/SSE caller if mcpUrl / MXC_MCP_URL is configured.
 */
async function callMxcMcp(
  toolName: string,
  args: Record<string, unknown>,
  mcpUrlOverride?: string | null,
  timeoutMs = 15_000,
): Promise<FastMcpRawResult | null> {
  const cfg = mcpUrlOverride ? null : await resolveMxcConfig();
  const mcpUrl = (mcpUrlOverride ?? cfg?.mcpUrl ?? process.env.MXC_MCP_URL)?.trim();
  if (!mcpUrl) {
    return null;
  }

  const endpoint = `${mcpUrl.replace(/\/sse\/?$/, "").replace(/\/+$/, "")}/call`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: toolName, arguments: args }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`MXC FastMCP call failed (${res.status}): ${errText}`);
    }

    const json = (await res.json()) as Record<string, any>;
    const rawText =
      typeof json.content?.[0]?.text === "string"
        ? json.content[0].text
        : JSON.stringify(json);
    const parsedJson = extractJsonObject(rawText);

    return {
      rawText,
      parsedJson,
      rawResponse: json,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonObject(raw: string): Record<string, any> | null {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        return JSON.parse(trimmed) as Record<string, any>;
      } catch {
        // continue
      }
    }
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1)) as Record<string, any>;
    } catch {
      return null;
    }
  }
  return null;
}

export type MxcTransportMode = "mcp" | "ssh" | "local";

export function getMxcTransportMode(): MxcTransportMode {
  const mcp = cachedPref?.value.mcpUrl || process.env.MXC_MCP_URL?.trim();
  if (mcp) {
    return "mcp";
  }
  const ssh = cachedPref?.value.remoteHost || process.env.MXC_REMOTE_HOST?.trim();
  if (ssh) {
    return "ssh";
  }
  return "local";
}

/**
 * Dynamically resolve the default/active Hyper-V or MXC sandbox ID from:
 * 1. Explicit argument
 * 2. User setting in /settings (`defaultSandboxId`)
 * 3. `session_status` / `pool_status` on the FastMCP host
 */
export async function resolveDefaultSandboxId(
  explicitId?: string | null,
  mcpUrlOverride?: string | null,
): Promise<string> {
  if (explicitId && explicitId.trim() && explicitId.trim() !== "auto") {
    return explicitId.trim();
  }

  const cfg = await resolveMxcConfig();
  if (
    !explicitId &&
    cfg.defaultSandboxId &&
    cfg.defaultSandboxId.trim() &&
    cfg.defaultSandboxId.trim() !== "auto"
  ) {
    return cfg.defaultSandboxId.trim();
  }

  if (cachedDiscoveredFallbackId) {
    return cachedDiscoveredFallbackId;
  }

  const mcpUrl = mcpUrlOverride ?? cfg.mcpUrl ?? process.env.MXC_MCP_URL;
  if (mcpUrl) {
    try {
      const sessionRes = await callMxcMcp("session_status", {}, mcpUrl);
      if (sessionRes?.rawText) {
        const activeMatch = sessionRes.rawText.match(
          /Active session sandbox:\s*(hv:[a-zA-Z0-9_-]+)/i,
        );
        if (activeMatch?.[1]) {
          cachedDiscoveredFallbackId = activeMatch[1];
          return activeMatch[1];
        }
        const fallbackMatch = sessionRes.rawText.match(
          /fallback:\s*(hv:[a-zA-Z0-9_-]+)/i,
        );
        if (fallbackMatch?.[1]) {
          cachedDiscoveredFallbackId = fallbackMatch[1];
          return fallbackMatch[1];
        }
      }
    } catch {
      // ignore discovery error and continue to pool status
    }
  }

  try {
    const pool = await mxcPoolStatus(mcpUrlOverride);
    if (pool.members.length > 0) {
      cachedDiscoveredFallbackId = pool.members[0].sandbox_id;
      return pool.members[0].sandbox_id;
    }
  } catch {
    // ignore
  }

  return cfg.defaultSandboxId?.trim() || "auto";
}

export interface MxcSandboxInstanceOption {
  readonly id: string;
  readonly label: string;
  readonly status: string;
}

/**
 * List available Hyper-V / MXC sandbox instances from the host for the /settings UI.
 */
export async function listMxcSandboxInstances(
  mcpUrlOverride?: string | null,
): Promise<MxcSandboxInstanceOption[]> {
  const options: MxcSandboxInstanceOption[] = [];
  const seen = new Set<string>();

  const cfg = await resolveMxcConfig();
  const mcpUrl = (mcpUrlOverride ?? cfg.mcpUrl ?? process.env.MXC_MCP_URL)?.trim();

  if (mcpUrl) {
    const sessionRes = await callMxcMcp("session_status", {}, mcpUrl);
    if (sessionRes?.rawText) {
      const activeMatch = sessionRes.rawText.match(
        /Active session sandbox:\s*(hv:[a-zA-Z0-9_-]+)/i,
      );
      if (activeMatch?.[1] && !seen.has(activeMatch[1])) {
        seen.add(activeMatch[1]);
        options.push({
          id: activeMatch[1],
          label: `${activeMatch[1]} (Active Session · Running)`,
          status: "running",
        });
      }
      const fallbackMatch = sessionRes.rawText.match(
        /fallback:\s*(hv:[a-zA-Z0-9_-]+)/i,
      );
      if (fallbackMatch?.[1] && !seen.has(fallbackMatch[1])) {
        seen.add(fallbackMatch[1]);
        cachedDiscoveredFallbackId = fallbackMatch[1];
        options.push({
          id: fallbackMatch[1],
          label: `${fallbackMatch[1]} (Primary Host VM · Running)`,
          status: "running",
        });
      }
    }
  }

  const pool = await mxcPoolStatus(mcpUrl);
  for (const member of pool.members) {
    if (!seen.has(member.sandbox_id)) {
      seen.add(member.sandbox_id);
      options.push({
        id: member.sandbox_id,
        label: `${member.sandbox_id} (${member.vm_name} · Pool ${member.status})`,
        status: member.status,
      });
    }
  }

  options.push({
    id: "auto",
    label: "auto (Auto-select / Warm Standby Pool Lease)",
    status: "auto",
  });

  return options;
}

// ===========================================================================
// MXC Operations (Tri-Mode Enabled)
// ===========================================================================

/**
 * Retrieve the current live status report of the MXC warm standby pool.
 */
export async function mxcPoolStatus(mcpUrlOverride?: string | null): Promise<MxcPoolStatus> {
  const cfg = await resolveMxcConfig();
  const mcpUrl = mcpUrlOverride ?? cfg.mcpUrl ?? process.env.MXC_MCP_URL;
  if (mcpUrl) {
    const mcpRes = await callMxcMcp("pool_status", {}, mcpUrl);
    if (mcpRes?.parsedJson) {
      const payload = mcpRes.parsedJson.result ?? mcpRes.parsedJson;
      return payload as MxcPoolStatus;
    }
  }

  const { stdout } = await runMxcCli([
    "--experimental",
    "--hyperv-op",
    "pool-status",
  ]);

  const parsed = extractJsonObject(stdout);
  if (!parsed) {
    throw new Error(`MXC pool status returned invalid JSON: ${stdout}`);
  }
  if (parsed.error) {
    throw new Error(
      `MXC pool status failed: ${parsed.error.message || JSON.stringify(parsed.error)}`,
    );
  }
  return parsed.result as MxcPoolStatus;
}

/**
 * Instantly lease a pre-warmed Windows Server 2025 sandbox from the standby pool in <300ms.
 */
export async function mxcPoolLease(holder = "eve-agent"): Promise<string> {
  const cfg = await resolveMxcConfig();
  if (cfg.mcpUrl || process.env.MXC_MCP_URL) {
    const mcpRes = await callMxcMcp("pool_lease", { lease_holder: holder });
    if (mcpRes) {
      const jsonId =
        mcpRes.parsedJson?.result?.sandboxId ||
        mcpRes.parsedJson?.result?.sandbox_id ||
        mcpRes.parsedJson?.sandbox_id;
      if (jsonId) {
        return String(jsonId);
      }
      const match = mcpRes.rawText.match(/'(hv:[a-zA-Z0-9_-]+)'/);
      if (match?.[1]) {
        return match[1];
      }
      if (mcpRes.rawText.includes("all instances are leased")) {
        return await resolveDefaultSandboxId();
      }
      throw new Error(`MXC pool lease failed: ${mcpRes.rawText}`);
    }
  }

  const { stdout } = await runMxcCli([
    "--experimental",
    "--hyperv-op",
    "pool-lease",
    "--pool-lease-holder",
    holder,
  ]);

  const parsed = extractJsonObject(stdout);
  if (!parsed || parsed.error) {
    throw new Error(
      `MXC pool lease failed: ${parsed?.error?.message || stdout}`,
    );
  }
  return (parsed.result.sandboxId || parsed.result.sandbox_id) as string;
}

/**
 * Return a leased VM back to the standby pool.
 * Automatically restores the VM to clean baseline snapshot, suspends it, and marks it Ready.
 */
export async function mxcPoolRelease(sandboxId: string): Promise<boolean> {
  const cfg = await resolveMxcConfig();
  if (cfg.mcpUrl || process.env.MXC_MCP_URL) {
    const mcpRes = await callMxcMcp("pool_release", { sandbox_id: sandboxId });
    if (mcpRes) return true;
  }

  const { stdout } = await runMxcCli([
    "--experimental",
    "--hyperv-op",
    "pool-release",
    "--hyperv-sandbox-id",
    sandboxId,
  ]);

  const parsed = extractJsonObject(stdout);
  if (parsed?.error) {
    throw new Error(
      `MXC pool release failed: ${parsed.error.message || JSON.stringify(parsed.error)}`,
    );
  }
  return true;
}

function parseMcpCommandOutput(
  rawText: string,
  sandboxId: string,
): MxcExecResult {
  const exitMatch = rawText.match(/^\[Exit Code:\s*(-?\d+)\]\r?\n?/);
  const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : 0;
  const body = exitMatch ? rawText.slice(exitMatch[0].length).trim() : rawText.trim();

  return {
    exitCode,
    stdout: exitCode === 0 ? body : "",
    stderr: exitCode !== 0 ? body : "",
    sandboxId,
  };
}

/**
 * Execute a command inside the isolated Hyper-V Windows Server 2025 guest sandbox.
 */
export async function mxcExecCommand(
  command: string,
  options: MxcExecOptions = {},
): Promise<MxcExecResult> {
  const cfg = await resolveMxcConfig();
  if (cfg.mcpUrl || process.env.MXC_MCP_URL) {
    let requestedId = await resolveDefaultSandboxId(options.sandboxId);

    let mcpRes = await callMxcMcp(
      "execute_command",
      {
        command,
        sandbox_id: requestedId,
        disposable: options.disposable ?? false,
      },
      undefined,
      25_000,
    );

    if (!mcpRes) {
      throw new Error("Empty response from MXC FastMCP execute_command");
    }

    const rawError = mcpRes.rawText;
    const isBrokenRemotingOrPaused =
      mcpRes.parsedJson?.error?.code === "not_started" ||
      mcpRes.parsedJson?.error?.code === "backend_error" ||
      rawError.includes("PSSessionStateBroken") ||
      rawError.includes("not in running state") ||
      rawError.includes("Exit Code: 4294967295");

    if (isBrokenRemotingOrPaused) {
      try {
        const leaseRes = await callMxcMcp(
          "session_acquire",
          { holder: "eve-agent" },
          undefined,
          10_000,
        );
        const match = leaseRes?.rawText?.match(/'(hv:[a-zA-Z0-9_-]+)'/);
        const nextId = match?.[1] || (await resolveDefaultSandboxId(null));
        if (nextId) {
          requestedId = nextId;
          const retryRes = await callMxcMcp(
            "execute_command",
            {
              command,
              sandbox_id: requestedId,
              disposable: options.disposable ?? false,
            },
            undefined,
            25_000,
          );
          if (retryRes) {
            mcpRes = retryRes;
          }
        }
      } catch (leaseErr) {
        console.warn("Failed to auto-acquire fresh MXC session VM:", leaseErr);
      }
    }

    return parseMcpCommandOutput(mcpRes.rawText, requestedId);
  }

  let targetSandboxId = options.sandboxId;
  let autoLeased = false;

  if (!targetSandboxId || targetSandboxId === "auto") {
    if (cfg.defaultSandboxId && cfg.defaultSandboxId !== "auto") {
      targetSandboxId = cfg.defaultSandboxId;
    } else {
      targetSandboxId = await mxcPoolLease("eve-exec");
      autoLeased = true;
    }
  }

  const template = cfg.repoRoot
    ? `${cfg.repoRoot}\\exec.json`
    : process.env.MXC_REMOTE_REPO_ROOT
      ? `${process.env.MXC_REMOTE_REPO_ROOT}\\exec.json`
      : getExecTemplatePath();

  const checkpointName = options.disposable ? `eve-disp-${Date.now()}` : null;

  try {
    if (checkpointName) {
      await mxcCreateCheckpoint(targetSandboxId, checkpointName);
    }

    const { stdout, stderr } = await runMxcCli([
      "--experimental",
      "--operation",
      "exec",
      "--container-id",
      targetSandboxId,
      template,
      "--",
      command,
    ]);

    return {
      exitCode: 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      sandboxId: targetSandboxId,
    };
  } catch (error: any) {
    if (checkpointName && targetSandboxId) {
      try {
        await mxcRestoreCheckpoint(targetSandboxId, checkpointName);
      } catch (rollbackErr) {
        console.warn("Failed to rollback disposable checkpoint", rollbackErr);
      }
    }

    return {
      exitCode: error.code || 1,
      stdout: error.stdout ? error.stdout.trim() : "",
      stderr: error.stderr ? error.stderr.trim() : error.message,
      sandboxId: targetSandboxId,
    };
  } finally {
    if (autoLeased && targetSandboxId) {
      try {
        await mxcPoolRelease(targetSandboxId);
      } catch (releaseErr) {
        console.warn("Failed to release auto-leased sandbox", releaseErr);
      }
    }
  }
}

/**
 * Capture a real-time screenshot of the Hyper-V guest desktop buffer via synthetic display controller WMI.
 */
export async function mxcCaptureScreenshot(
  sandboxId?: string,
  destPath?: string,
): Promise<MxcScreenshotResult> {
  const cfg = await resolveMxcConfig();
  const resolvedId = await resolveDefaultSandboxId(sandboxId);

  if (cfg.mcpUrl || process.env.MXC_MCP_URL) {
    const mcpRes = await callMxcMcp("capture_screenshot", {
      sandbox_id: resolvedId,
      width: 1024,
      height: 768,
    });
    if (mcpRes) {
      if (mcpRes.parsedJson?.data_url) {
        return {
          sandboxId: mcpRes.parsedJson.sandbox_id || resolvedId,
          imagePath: mcpRes.parsedJson.file_path || "",
          dataUrl: mcpRes.parsedJson.data_url,
          width: mcpRes.parsedJson.width || 1024,
          height: mcpRes.parsedJson.height || 768,
        };
      }
      const pathMatch = mcpRes.rawText.match(/Path:\s*(.+)/);
      const dimsMatch = mcpRes.rawText.match(/\((\d+)x(\d+),/);
      return {
        sandboxId: resolvedId,
        imagePath: pathMatch?.[1]?.trim() || "",
        dataUrl: "",
        width: dimsMatch ? Number.parseInt(dimsMatch[1], 10) : 1024,
        height: dimsMatch ? Number.parseInt(dimsMatch[2], 10) : 768,
      };
    }
  }

  const repo = cfg.repoRoot || process.env.MXC_REMOTE_REPO_ROOT || getMxcRepoRoot();
  const scriptPath = `${repo}\\scripts\\hyperv\\capture_screenshot.ps1`;

  const vmName = resolvedId.startsWith("hv:")
    ? `mxc-hv-${resolvedId.replace(/^hv:/, "")}`
    : resolvedId;

  const localOutPath = destPath || join(tmpdir(), `mxc-screen-${Date.now()}.png`);
  const remoteOutPath = `C:\\Windows\\Temp\\mxc-screen-${Date.now()}.png`;
  const isRemote = Boolean(cfg.remoteHost || process.env.MXC_REMOTE_HOST);

  // Script captures the image and emits base64 directly to stdout
  const psScript = `
    $out = '${isRemote ? remoteOutPath : localOutPath}';
    & "${scriptPath}" -VmName '${vmName}' -OutputPath $out | Out-Null;
    if (Test-Path $out) {
        [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($out))
    } else {
        throw "Failed to capture screenshot at $out"
    }
  `;

  const { stdout } = await runHostPowershell(psScript);
  const base64 = stdout.trim();

  if (!base64) {
    throw new Error("No screenshot data received from Hyper-V host.");
  }

  // If local, ensure file exists on disk
  if (!isRemote && !existsSync(localOutPath)) {
    writeFileSync(localOutPath, Buffer.from(base64, "base64"));
  }

  return {
    sandboxId: resolvedId,
    imagePath: localOutPath,
    dataUrl: `data:image/png;base64,${base64}`,
    width: 1024,
    height: 768,
  };
}

/**
 * Create a named checkpoint for a sandbox.
 */
export async function mxcCreateCheckpoint(
  sandboxId: string,
  checkpointName: string,
): Promise<void> {
  const cfg = await resolveMxcConfig();
  const resolvedId = await resolveDefaultSandboxId(sandboxId);
  if (cfg.mcpUrl || process.env.MXC_MCP_URL) {
    await callMxcMcp("create_checkpoint", {
      name: checkpointName,
      sandbox_id: resolvedId,
    });
    return;
  }

  await runMxcCli([
    "--experimental",
    "--hyperv-op",
    "checkpoint",
    "--hyperv-sandbox-id",
    resolvedId,
    "--hyperv-checkpoint-name",
    checkpointName,
  ]);
}

/**
 * Restore a named checkpoint for a sandbox.
 */
export async function mxcRestoreCheckpoint(
  sandboxId: string,
  checkpointName: string,
): Promise<void> {
  const cfg = await resolveMxcConfig();
  const resolvedId = await resolveDefaultSandboxId(sandboxId);
  if (cfg.mcpUrl || process.env.MXC_MCP_URL) {
    await callMxcMcp("rollback_checkpoint", {
      name: checkpointName,
      sandbox_id: resolvedId,
    });
    return;
  }

  await runMxcCli([
    "--experimental",
    "--hyperv-op",
    "restore",
    "--hyperv-sandbox-id",
    resolvedId,
    "--hyperv-checkpoint-name",
    checkpointName,
  ]);
}

/**
 * Set network connectivity (Default Switch) for hot-plugging internet or airgapping.
 */
export async function mxcSetNetwork(
  sandboxId: string | undefined,
  enabled: boolean,
): Promise<{ sandboxId: string; connected: boolean }> {
  const cfg = await resolveMxcConfig();
  const resolvedId = await resolveDefaultSandboxId(sandboxId);

  if (cfg.mcpUrl || process.env.MXC_MCP_URL) {
    await callMxcMcp("set_network", {
      enabled,
      sandbox_id: resolvedId,
    });
    return { sandboxId: resolvedId, connected: enabled };
  }

  const vmName = resolvedId.startsWith("hv:")
    ? `mxc-hv-${resolvedId.replace(/^hv:/, "")}`
    : resolvedId;

  const psScript = enabled
    ? `Connect-VMNetworkAdapter -VMName '${vmName}' -SwitchName 'Default Switch' | Out-Null; 'connected'`
    : `Get-VMNetworkAdapter -VMName '${vmName}' | Disconnect-VMNetworkAdapter | Out-Null; 'disconnected'`;

  await runHostPowershell(psScript);
  return { sandboxId: resolvedId, connected: enabled };
}
