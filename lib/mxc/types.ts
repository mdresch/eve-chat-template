export interface MxcPoolMember {
  readonly token: string;
  readonly sandbox_id: string;
  readonly vm_name: string;
  readonly status: "ready" | "leased" | "recycling";
  readonly leased_to?: string | null;
  readonly leased_at_utc?: string | null;
}

export interface MxcPoolStatus {
  readonly target_size: number;
  readonly total_members: number;
  readonly ready_count: number;
  readonly leased_count: number;
  readonly members: readonly MxcPoolMember[];
}

export interface MxcExecOptions {
  readonly sandboxId?: string;
  readonly workingDirectory?: string;
  readonly disposable?: boolean;
}

export interface MxcExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly sandboxId: string;
}

export interface MxcScreenshotResult {
  readonly sandboxId: string;
  readonly imagePath: string;
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}
