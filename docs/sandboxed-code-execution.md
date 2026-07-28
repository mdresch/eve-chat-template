# Sandboxed Code Execution

This document explains the Docker-backed sandbox: how the agent runs shell
commands, how the chat UI surfaces the container behind a chat, and how idle
containers get cleaned up.

## Sandbox Backend

`agent/sandbox.ts` declares the sandbox with `defineSandbox` from
`eve/sandbox`, pinned to the Docker backend (`eve/sandbox/docker`):

```ts
export default defineSandbox({
  backend: docker(),
  async onSession({ use, ctx }) { ... },
});
```

It is pinned to Docker deliberately, not left to eve's default backend
selection, so the sandbox behaves identically locally and in this app's own
deployment regardless of whether `process.env.VERCEL` is set. Declaring
`agent/sandbox.ts` is what makes eve's default `bash` tool available to the
agent at all.

`onSession` opens the sandbox (`use()`) and immediately records the Docker
container name against the chat row via `recordChatSandboxContainer`
(`lib/db/queries.ts`), tagging it with the eve `session.id`. This runs even
for turns that never call `bash`, so the container name is available as soon
as the sandbox opens rather than only after a tool call.

## The `bash` Tool

`agent/tools/bash.ts` wraps eve's framework-default `bash` tool
(`eve/tools/defaults`) rather than replacing it:

```ts
export default defineTool({
  ...bash,
  async execute(input, ctx) {
    const result = await bash.execute(input, ctx);
    const sandbox = await ctx.getSandbox();
    void recordChatSandboxContainer({ containerName: sandbox.id, sessionId: ctx.session.id });
    return { ...result, sandbox: { containerName: sandbox.id } };
  },
});
```

This does two things beyond the default behavior:

1. Records the container name again on every call (redundant with
   `agent/sandbox.ts`'s `onSession` for the common case, but necessary for
   sessions that reuse an existing sandbox without going through
   `onSession` again).
2. Returns `sandbox.containerName` alongside the normal tool output, so the
   container name rides along on the chat's own event log — no separate
   client-side fetch needed to know which container backs a chat.

## Surfacing The Container In The UI

`lib/chat/sandbox.ts` (`findLatestSandboxContainerName`) scans a chat's
messages backwards for the most recent `bash` tool call's output and reads
`output.sandbox.containerName` from it.

`app/_components/agent-chat.tsx` prefers the server-recorded value
(`activeChat.sandboxContainerName`, set by `agent/sandbox.ts`'s `onSession`)
over the value derived from scanning tool call output, since the server-side
recording covers sessions that never call `bash` at all.

The session header (`SessionHeader` in `agent-chat.tsx`) renders an
"Open `<container>` in VS Code" link once a container name is known:

```txt
vscode://vscode-remote/attached-container+<encoded-name>/workspace
```

This is an unofficial deep link into VS Code's Dev Containers extension. It
only works if the person clicking it has Docker and that extension installed
locally, and the container is actually running (see idle cleanup below).

`chat.sandboxContainerName` is a plain text column on the `chat` table
(`lib/db/schema.ts`) — it is a UI convenience, not something eve itself
tracks.

## Idle Cleanup

Sandbox containers stay around after a turn ends so the next turn in the same
chat can resume the same filesystem. Left unchecked, that accumulates
containers indefinitely, so a cron job stops (never removes) idle ones.

This project schedules it with an [Upstash QStash](https://upstash.com/docs/qstash)
Schedule rather than Vercel Cron: Vercel Hobby plans cap Cron Jobs at
once/day, too infrequent for idle cleanup. Create a Schedule in the Upstash
console with:

- Destination: `https://<your-production-domain>/api/cron/sandbox-cleanup`
- Method: `GET`
- Cron expression: `*/15 * * * *`
- Header: `Authorization: Bearer <CRON_SECRET>`

`app/api/cron/sandbox-cleanup/route.ts` checks for that same header on every
request:

```txt
Authorization: Bearer <CRON_SECRET>
```

Requests without a matching header get a 401.

The route calls `stopIdleSandboxContainers` (`lib/sandbox/idle-cleanup.ts`)
with a 30-minute idle threshold:

1. `listIdleChatsWithSandboxSession` (`lib/db/queries.ts`) finds chats whose
   `eveSession` exists and haven't been touched since the threshold.
2. For each, it looks up the currently *running* Docker container labeled
   `eve.sandbox.tag.sessionId=<sessionId>` (a label eve's own Docker backend
   already stamps on every session container).
3. If one is running, it runs `docker stop -t 0 <container>`.

It deliberately never runs `docker rm`. eve's Docker backend reconnects to a
stopped container by name on that chat's next turn (`docker start`), so
stopping only reclaims idle compute — the workspace filesystem and the
chat's ability to resume are both preserved.

This means the cron job, `app/api/cron/sandbox-cleanup/route.ts`, and
`lib/sandbox/idle-cleanup.ts` all need to run somewhere with access to the
same Docker daemon the sandbox backend itself uses (the local Docker socket
in dev, or wherever this app's own deployment runs Docker — this is not
compatible with a stock Vercel serverless deployment, which has no Docker
daemon to talk to).

## Required Environment Variable

```bash
CRON_SECRET=
```

Required for the idle-cleanup cron to authenticate. Set it in this app's own
environment, and configure the Upstash QStash schedule's request to send it
as the `Authorization: Bearer <CRON_SECRET>` header.

## Local Development

Locally, `pnpm dev` plus a running Docker daemon is enough — the sandbox
backend talks to Docker directly, and you can call
`GET /api/cron/sandbox-cleanup` by hand (with the right bearer token) to test
cleanup without waiting on the schedule.
