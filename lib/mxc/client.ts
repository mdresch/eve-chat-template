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
  // Create a fallback template in tmp if missing
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

/**
 * Retrieve the current live status report of the MXC warm standby pool.
 */
export async function mxcPoolStatus(): Promise<MxcPoolStatus> {
  const exe = getMxcExecPath();
  const { stdout } = await execFileAsync(exe, [
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
  const exe = getMxcExecPath();
  const { stdout } = await execFileAsync(exe, [
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
  const exe = getMxcExecPath();
  const { stdout } = await execFileAsync(exe, [
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
  const exe = getMxcExecPath();
  const template = getExecTemplatePath();

  // If no sandboxId is passed, lease a pre-warmed one or pick the first ready member
  let targetSandboxId = options.sandboxId;
  let autoLeased = false;

  if (!targetSandboxId || targetSandboxId === "auto") {
    targetSandboxId = await mxcPoolLease("eve-exec");
    autoLeased = true;
  }

  const checkpointName = options.disposable
    ? `eve-disp-${Date.now()}`
    : null;

  try {
    if (checkpointName) {
      await mxcCreateCheckpoint(targetSandboxId, checkpointName);
    }

    const { stdout, stderr } = await execFileAsync(exe, [
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
  const repo = getMxcRepoRoot();
  const scriptPath = join(repo, "scripts", "hyperv", "capture_screenshot.ps1");

  // Determine VM Name from sandboxId (e.g. hv:a7df7452 -> mxc-hv-a7df7452)
  let vmName = "mxc-hv-a7df7452"; // default active VM
  if (sandboxId && sandboxId.startsWith("hv:")) {
    const token = sandboxId.replace(/^hv:/, "");
    vmName = `mxc-hv-${token}`;
  }

  const outPath = destPath || join(tmpdir(), `mxc-screen-${Date.now()}.png`);

  const psScript = `
    & "${scriptPath}" -VmName '${vmName}' -OutputPath '${outPath}'
  `;

  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    psScript,
  ]);

  if (!existsSync(outPath)) {
    throw new Error(`Screenshot file was not generated at ${outPath}`);
  }

  const buffer = readFileSync(outPath);
  const base64 = buffer.toString("base64");
  const dataUrl = `data:image/png;base64,${base64}`;

  return {
    sandboxId: sandboxId || vmName,
    imagePath: outPath,
    dataUrl,
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
  const exe = getMxcExecPath();
  await execFileAsync(exe, [
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
  const exe = getMxcExecPath();
  await execFileAsync(exe, [
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

  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    psScript,
  ]);

  return { sandboxId, connected: enabled };
}
