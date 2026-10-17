import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  MxcExecOptions,
  MxcExecResult,
  MxcPoolStatus,
  MxcScreenshotResult,
} from "./types";

const execFileAsync = promisify(execFile);

// ===========================================================================
// Configuration & Path Resolution
// ===========================================================================

export function getMxcRepoRoot(): string {
  if (process.env.MXC_REPO_ROOT && existsSync(process.env.MXC_REPO_ROOT)) {
    return process.env.MXC_REPO_ROOT;
  }
  const defaultPath = "C:\\Users\\MennoDrescher\\source\\repos\\mxc";
  if (existsSync(defaultPath)) {
    return defaultPath;
  }
  return process.cwd();
}

export function getMxcExecPath(): string {
  if (process.env.MXC_EXEC_PATH && existsSync(process.env.MXC_EXEC_PATH)) {
    return process.env.MXC_EXEC_PATH;
  }
  const repo = getMxcRepoRoot();
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

export function getExecTemplatePath(): string {
  const repo = getMxcRepoRoot();
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
        2
      )
    );
  }
  return fallback;
}

// ===========================================================================
// Tri-Mode Dispatcher Layer
// ===========================================================================

/**
 * Execute CLI commands across all 3 modes:
 * - Mode 1: FastMCP HTTP/SSE (if MXC_MCP_URL is defined)
 * - Mode 2: Remote execution over SSH (if MXC_REMOTE_HOST is defined)
 * - Mode 3: Local execution on Hyper-V host
 */
export async function runMxcCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  // Mode 2: Remote execution over SSH / Tailscale
  const remoteHost = process.env.MXC_REMOTE_HOST;
  if (remoteHost) {
    const remoteExe =
      process.env.MXC_REMOTE_EXEC_PATH ||
      "C:\\Users\\MennoDrescher\\source\\repos\\mxc\\src\\target\\debug\\wxc-exec.exe";
    const quotedArgs = args
      .map((a) => (a.includes(" ") ? `"${a.replace(/"/g, '`"')}"` : a))
      .join(" ");
    const remoteCmd = `& "${remoteExe}" ${quotedArgs}`;

    return await execFileAsync("ssh", [remoteHost, remoteCmd]);
  }

  // Mode 3: Direct local execution
  const exe = getMxcExecPath();
  return await execFileAsync(exe, args);
}

/**
 * Runs a PowerShell command against the host (local or remote SSH).
 */
export async function runHostPowershell(psScript: string): Promise<{ stdout: string; stderr: string }> {
  const remoteHost = process.env.MXC_REMOTE_HOST;

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

/**
 * Mode 1: Optional FastMCP HTTP/SSE caller if MXC_MCP_URL is configured.
 */
async function callMxcMcp(toolName: string, args: Record<string, unknown>): Promise<any> {
  const mcpUrl = process.env.MXC_MCP_URL;
  if (!mcpUrl) {
    return null;
  }

  const endpoint = `${mcpUrl.replace(/\/sse\/?$/, "").replace(/\/+$/, "")}/call`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: toolName, arguments: args }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`MXC FastMCP call failed (${res.status}): ${errText}`);
  }

  const json = await res.json();
  return json.content?.[0]?.text ? JSON.parse(json.content[0].text) : json;
}

// ===========================================================================
// MXC Operations (Tri-Mode Enabled)
// ===========================================================================

/**
 * Retrieve the current live status report of the MXC warm standby pool.
 */
export async function mxcPoolStatus(): Promise<MxcPoolStatus> {
  if (process.env.MXC_MCP_URL) {
    const mcpRes = await callMxcMcp("pool_status", {});
    if (mcpRes) return mcpRes as MxcPoolStatus;
  }

  const { stdout } = await runMxcCli([
    "--experimental",
    "--hyperv-op",
    "pool-status",
  ]);

  const parsed = JSON.parse(stdout);
  if (parsed.error) {
    throw new Error(`MXC pool status failed: ${parsed.error.message || JSON.stringify(parsed.error)}`);
  }
  return parsed.result as MxcPoolStatus;
}

/**
 * Instantly lease a pre-warmed Windows Server 2025 sandbox from the standby pool in <300ms.
 */
export async function mxcPoolLease(holder = "eve-agent"): Promise<string> {
  if (process.env.MXC_MCP_URL) {
    const mcpRes = await callMxcMcp("pool_lease", { lease_holder: holder });
    if (mcpRes?.sandbox_id) return mcpRes.sandbox_id;
  }

  const { stdout } = await runMxcCli([
    "--experimental",
    "--hyperv-op",
    "pool-lease",
    "--pool-lease-holder",
    holder,
  ]);

  const parsed = JSON.parse(stdout);
  if (parsed.error) {
    throw new Error(`MXC pool lease failed: ${parsed.error.message || JSON.stringify(parsed.error)}`);
  }
  return parsed.result.sandboxId as string;
}

/**
 * Return a leased VM back to the standby pool.
 * Automatically restores the VM to clean baseline snapshot, suspends it, and marks it Ready.
 */
export async function mxcPoolRelease(sandboxId: string): Promise<boolean> {
  if (process.env.MXC_MCP_URL) {
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

  const parsed = JSON.parse(stdout);
  if (parsed.error) {
    throw new Error(`MXC pool release failed: ${parsed.error.message || JSON.stringify(parsed.error)}`);
  }
  return true;
}

/**
 * Execute a command inside the isolated Hyper-V Windows Server 2025 guest sandbox.
 */
export async function mxcExecCommand(
  command: string,
  options: MxcExecOptions = {}
): Promise<MxcExecResult> {
  let targetSandboxId = options.sandboxId;
  let autoLeased = false;

  if (!targetSandboxId || targetSandboxId === "auto") {
    targetSandboxId = await mxcPoolLease("eve-exec");
    autoLeased = true;
  }

  if (process.env.MXC_MCP_URL) {
    try {
      const mcpRes = await callMxcMcp("execute_command", {
        command,
        sandbox_id: targetSandboxId,
        disposable: options.disposable ?? false,
        working_directory: options.workingDirectory,
      });

      return {
        exitCode: mcpRes.exit_code ?? 0,
        stdout: mcpRes.stdout ?? "",
        stderr: mcpRes.stderr ?? "",
        sandboxId: targetSandboxId,
      };
    } finally {
      if (autoLeased && targetSandboxId) {
        await mxcPoolRelease(targetSandboxId).catch(() => {});
      }
    }
  }

  const template =
    process.env.MXC_REMOTE_REPO_ROOT
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
  destPath?: string
): Promise<MxcScreenshotResult> {
  if (process.env.MXC_MCP_URL) {
    const mcpRes = await callMxcMcp("capture_screenshot", { sandbox_id: sandboxId || "auto" });
    if (mcpRes?.data_url) {
      return {
        sandboxId: mcpRes.sandbox_id || sandboxId || "mxc-hv",
        imagePath: mcpRes.file_path || "",
        dataUrl: mcpRes.data_url,
        width: mcpRes.width || 1024,
        height: mcpRes.height || 768,
      };
    }
  }

  const repo = process.env.MXC_REMOTE_REPO_ROOT || getMxcRepoRoot();
  const scriptPath = `${repo}\\scripts\\hyperv\\capture_screenshot.ps1`;

  let vmName = "mxc-hv-a7df7452";
  if (sandboxId && sandboxId.startsWith("hv:")) {
    vmName = `mxc-hv-${sandboxId.replace(/^hv:/, "")}`;
  }

  const localOutPath = destPath || join(tmpdir(), `mxc-screen-${Date.now()}.png`);
  const remoteOutPath = `C:\\Windows\\Temp\\mxc-screen-${Date.now()}.png`;

  // Script captures the image and emits base64 directly to stdout
  const psScript = `
    $out = '${process.env.MXC_REMOTE_HOST ? remoteOutPath : localOutPath}';
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
  if (!process.env.MXC_REMOTE_HOST && !existsSync(localOutPath)) {
    writeFileSync(localOutPath, Buffer.from(base64, "base64"));
  }

  return {
    sandboxId: sandboxId || vmName,
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
  checkpointName: string
): Promise<void> {
  await runMxcCli([
    "--experimental",
    "--hyperv-op",
    "checkpoint",
    "--hyperv-sandbox-id",
    sandboxId,
    "--hyperv-checkpoint-name",
    checkpointName,
  ]);
}

/**
 * Restore a named checkpoint for a sandbox.
 */
export async function mxcRestoreCheckpoint(
  sandboxId: string,
  checkpointName: string
): Promise<void> {
  await runMxcCli([
    "--experimental",
    "--hyperv-op",
    "restore",
    "--hyperv-sandbox-id",
    sandboxId,
    "--hyperv-checkpoint-name",
    checkpointName,
  ]);
}

/**
 * Set network connectivity (Default Switch) for hot-plugging internet or airgapping.
 */
export async function mxcSetNetwork(
  sandboxId: string,
  enabled: boolean
): Promise<{ sandboxId: string; connected: boolean }> {
  let vmName = "mxc-hv-a7df7452";
  if (sandboxId && sandboxId.startsWith("hv:")) {
    vmName = `mxc-hv-${sandboxId.replace(/^hv:/, "")}`;
  }

  const psScript = enabled
    ? `Connect-VMNetworkAdapter -VMName '${vmName}' -SwitchName 'Default Switch' | Out-Null; 'connected'`
    : `Get-VMNetworkAdapter -VMName '${vmName}' | Disconnect-VMNetworkAdapter | Out-Null; 'disconnected'`;

  await runHostPowershell(psScript);
  return { sandboxId, connected: enabled };
}
