import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SandboxTelemetry = {
  available: boolean;
  containerId?: string;
  name?: string;
  cpu?: string;
  memory?: string;
  memPerc?: string;
  netIO?: string;
  blockIO?: string;
  pids?: string;
};

// Validates container identifier: alphanumeric, hyphen, underscore, or hv: prefix
function isValidContainerName(name: string): boolean {
  return /^(hv:)?[a-zA-Z0-9_-]{1,128}$/.test(name);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let containerName = searchParams.get("containerName")?.trim();

  if (containerName && containerName.startsWith("hv:") && isValidContainerName(containerName)) {
    const mode = process.env.MXC_MCP_URL?.trim()
      ? "MCP"
      : process.env.MXC_REMOTE_HOST?.trim()
        ? "SSH"
        : "Hyper-V";
    return NextResponse.json<SandboxTelemetry>({
      available: true,
      containerId: containerName,
      cpu: mode,
      memory: "4.0GiB / 4.0GiB",
      name: containerName,
    });
  }

  try {
    const dockerExecutable = process.env.EVE_DOCKER_PATH || "docker";

    if (!containerName || containerName === "auto") {
      const { stdout: idOut } = await execFileAsync(
        dockerExecutable,
        ["ps", "--filter", "name=eve-sbx-ses-docker", "--format", "{{.ID}}", "-n", "1"],
        { timeout: 2500 },
      );
      containerName = idOut.trim().split("\n")[0]?.trim();
    }

    if (!containerName || !isValidContainerName(containerName)) {
      return NextResponse.json<SandboxTelemetry>({ available: false });
    }

    const { stdout } = await execFileAsync(
      dockerExecutable,
      ["stats", "--no-stream", "--format", "{{json .}}", containerName],
      { timeout: 3500 },
    );

    const line = stdout.trim().split("\n")[0];
    if (!line) {
      return NextResponse.json<SandboxTelemetry>({ available: false });
    }

    const raw = JSON.parse(line) as {
      ID?: string;
      Name?: string;
      CPUPerc?: string;
      MemUsage?: string;
      MemPerc?: string;
      NetIO?: string;
      BlockIO?: string;
      PIDs?: string;
    };

    return NextResponse.json<SandboxTelemetry>({
      available: true,
      blockIO: raw.BlockIO,
      containerId: raw.ID,
      cpu: raw.CPUPerc,
      memory: raw.MemUsage,
      memPerc: raw.MemPerc,
      name: raw.Name,
      netIO: raw.NetIO,
      pids: raw.PIDs,
    });
  } catch {
    // Fail open gracefully if docker is not running or container has terminated
    return NextResponse.json<SandboxTelemetry>({ available: false });
  }
}
