---
description: Systematically troubleshoot broken builds, failed tests, or sandbox/VM execution issues.
---

When troubleshooting runtime or sandbox failures:
1. Identify the active execution backend (Docker container or Hyper-V Windows Server 2025 guest).
2. For containerized environments, run diagnostic checks via `bash` (environment variables, dependencies, disk space, and exit codes).
3. For Hyper-V Windows Server 2025 VMs, execute commands via `mxc_exec` with PowerShell Direct. Use `disposable: true` for risky or dirty operations to auto-rollback on failure.
4. If a guest UI, installer, or window state is unclear, call `mxc_screenshot` to visually inspect the guest desktop.
5. Isolate the root cause before editing code, and verify the fix by re-running the test or command.

