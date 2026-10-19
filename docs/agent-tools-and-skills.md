# Agent Tools And Skills

This document catalogs the local tools and skills defined in this template,
and how to add more of each. For MCP connections (Notion, Linear, Sentry,
Atlassian, Shortcut) see
[How the Chatbot Works](how-the-chatbot-works.md#adding-a-new-connection); for
the sandbox and `bash` see
[Sandboxed Code Execution](sandboxed-code-execution.md); for the
`pmbok-specialist` subagent see
[PMBOK Specialist Subagent](pmbok-specialist-subagent.md).

## Tools

Tools live in `agent/tools/`. Each file exports a `defineTool(...)` from
`eve/tools`, and the runtime tool name is derived from the filename — tool
filenames must be snake_case ASCII.

| File | Tool name | Purpose |
| --- | --- | --- |
| `agent/tools/bash.ts` | `bash` | Wraps eve's default sandboxed `bash` tool to route commands to Docker or Hyper-V Windows Server 2025 and record container telemetry. See [Sandboxed Code Execution](sandboxed-code-execution.md). |
| `agent/tools/mxc_exec.ts` | `mxc_exec` | Runs commands inside Hyper-V Windows Server 2025 guest via PowerShell Direct with optional disposable rollback on failure. |
| `agent/tools/mxc_screenshot.ts` | `mxc_screenshot` | Captures guest desktop screenshot buffer for visual inspection of UI/installers. |
| `agent/tools/mxc_pool.ts` | `mxc_pool` | Inspects, leases, and resets Hyper-V standby sandboxes. |
| `agent/tools/mxc_network.ts` | `mxc_network` | Toggles VM network adapter between internet-connected and airgap isolation. |
| `agent/tools/web_search.ts` | `web_search` | Searches the web via the Exa API. Requires `EXA_API_KEY`; throws a clear error if unconfigured. Overrides eve's built-in provider-managed web search tool with this Exa-backed one. Duplicated as `tools/web_search.ts` inside each of the five [PMBOK stage subagents](pmbok-specialist-subagent.md#nested-subagents-dont-inherit-connections-or-tools), since subagents don't inherit the root's tools. |
| `agent/tools/workflow.ts` | (framework) | Opts into eve's experimental `Workflow` tool (`experimental_workflow()`) — lets the model write JS that orchestrates parallel/sequential calls to its own subagents as one durable step. |

eve also provides built-in tools out of the box: `read_file`, `write_file`, `glob`, `grep`, `web_fetch`, `todo`, and `ask_question`.

`web_search` reports a `web_search_duration` Sentry metric on every call (see
[Observability](observability.md)).

### Adding A New Tool

1. Create `agent/tools/<snake_case_name>.ts`.
2. Export a `defineTool({ description, inputSchema, execute })` — `inputSchema`
   is a Zod schema.
3. Keep tool output structured (plain JSON), not prose-only — the message
   renderer (`components/chat/message.tsx`) can render much better tool UI
   when output is predictable JSON.
4. Update `agent/instructions.md` so the agent knows when to use it.
5. If the UI should render a special state for this tool's output, extend
   `components/chat/message.tsx`.

## Skills

Skills live in `agent/skills/` as Markdown files with frontmatter. eve loads
a skill's instructions on demand (via `load_skill`) rather than keeping every
skill's full body in context on every turn — only the skill's `description`
is always visible to the model, so it can decide when to load the rest.

| File | Description (frontmatter) |
| --- | --- |
| `agent/skills/code_review.md` | Perform a comprehensive, senior-level code review on a diff, file, or implementation. |
| `agent/skills/sandbox_troubleshooting.md` | Systematically troubleshoot broken builds, failed tests, or sandbox/VM execution issues. |

Skills are not subagents. `agent/instructions.md` calls this out explicitly
for `pmbok-specialist`: it is a subagent tool, and `load_skill` does not
apply to it — `load_skill` only loads this agent's own on-demand skill
instructions.

### Adding A New Skill

1. Create `agent/skills/<name>.md` with frontmatter:
   ```md
   ---
   description: One sentence — when should the model reach for this skill?
   ---
   ```
2. Write the instructions the model should follow once it loads this skill.
   Keep them concise and actionable — this is what gets injected into context
   once `load_skill` is called, not a place for background explanation.
3. If the skill depends on a tool that doesn't exist yet, add that tool first
   (see above).

## Required Environment Variable

```bash
EXA_API_KEY=
```

Required for `web_search`. Get a key at [exa.ai](https://exa.ai). Without it,
the tool throws `"Web search is not configured (missing EXA_API_KEY)."`
rather than silently failing or falling back to a different provider.
