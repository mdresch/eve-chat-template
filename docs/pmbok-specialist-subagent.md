# PMBOK Specialist Subagent

This document explains the `pmbok-specialist` subagent: a multi-stage agent
pipeline that turns a raw project idea into a chain of PMBOK-style project
management deliverables, publishing each one to Notion, Linear, or Shortcut.

It exists as a worked example of eve subagent composition in this template —
nested subagents, structured handoffs between stages, and an orchestrator
that holds the only connections in the pipeline.

## When It Runs

`agent/instructions.md` tells the root agent to delegate here whenever a user
describes a project idea and wants help turning it into a real project, by
calling the `pmbok-specialist` tool directly (it is a subagent, not a skill —
`load_skill` does not apply to it).

## Structure

```txt
agent/subagents/pmbok-specialist/
  agent.ts                     orchestrator (claude-opus-5)
  instructions.md               orchestration logic (see below)
  connections/{linear,notion,shortcut}.ts   publishing destinations
  subagents/
    ideation/{agent.ts,instructions.md,tools/web_search.ts}                  raw idea -> Ideation Document
    business-case/{agent.ts,instructions.md,tools/web_search.ts}             Ideation Document -> Business Case
    stakeholder-register/{agent.ts,instructions.md,tools/web_search.ts}      Business Case -> Stakeholder Register
    project-charter/{agent.ts,instructions.md,tools/web_search.ts}           Business Case -> Project Charter
    management-plans/{agent.ts,instructions.md,tools/web_search.ts}          Project Charter + Stakeholder Register -> Management Plans
```

The orchestrator (`agent/subagents/pmbok-specialist/agent.ts`) runs on
`claude-opus-5`; every nested stage subagent runs on `claude-sonnet-5`. Both
use `definePerUserModel` (see
[Per-User AI Providers](byok-model-providers.md)), so a signed-in user's BYOK
provider applies inside this pipeline too.

## Pipeline Order

Defined in the orchestrator's `instructions.md`:

1. **`ideation`** — input: the user's raw idea (plus a template if given).
   Output: an Ideation Document.
2. **`business-case`** — input: the Ideation Document. Output: a Business
   Case.
3. **`stakeholder-register`** and **`project-charter`** — both take the
   Business Case as input and run *in parallel*: the orchestrator emits both
   tool calls in the same response so eve dispatches them concurrently,
   rather than calling one and waiting before starting the other.
4. **`management-plans`** — input: the Project Charter and the Stakeholder
   Register (both must have completed first). Output: the subsidiary
   management plans plus the integrated Project Management Plan.

Each stage is called as a nested subagent tool by its bare name (no prefix),
and each is called with `outputSchema` so it returns structured JSON instead
of prose:

```json
{
  "title": "string",
  "content": "string — the full deliverable, ready to publish as-is",
  "summary": "string — 2-4 sentences for the next stage",
  "keyFacts": ["string — decisions/data downstream stages depend on"]
}
```

The orchestrator packs each stage's `message` from the **prior stage's
`summary` and `keyFacts`**, not its full `content` — the full deliverable
text lives in what gets published, not in the conversation — plus the
published URL(s) so far, so later deliverables can reference earlier ones by
link. This keeps context lean as the pipeline gets deeper.

## Nested Subagents Don't Inherit Connections Or Tools

Every stage subagent only drafts; it never publishes. The orchestrator holds
`agent/subagents/pmbok-specialist/connections/{linear,notion,shortcut}.ts`
and is the only one that calls Notion/Linear/Shortcut tools.

These connection files are declared separately from the root's
`agent/connections/*.ts` — comments in each file call this out explicitly.
Subagents do not inherit the root agent's connections or tools (see the
"isolation boundary" section of `node_modules/eve/docs/subagents.mdx`), so
any subagent that needs a connection or a tool has to declare its own, even
when it reuses the same underlying resource (the same Vercel Connect
connector via `process.env.LINEAR_CONNECTOR`, etc.).

This is why each of the five stage subagents also carries its own
`tools/web_search.ts`, identical to the root's
[`agent/tools/web_search.ts`](agent-tools-and-skills.md#tools). Without it, a
stage subagent falls back to eve's framework-default `web_search`
placeholder, which is swapped at call time for a provider-native search tool
matched to the active model backend (OpenAI/Anthropic/Google), or Vercel AI
Gateway's `parallel_search` for anything else. Under a BYOK Bifrost, Ollama,
or Foundry Local credential (see [Per-User AI Providers](byok-model-providers.md)),
that gateway tool isn't supported by the underlying provider, so the AI SDK
warns and silently drops it — the stage would have no working web search at
all, without any visible error. Giving each stage its own Exa-backed copy
sidesteps that placeholder entirely, the same way the root's copy does.

Keep this in mind when adding a new subagent that needs to call out to an
external service or reuses a root tool — see
[How the Chatbot Works](how-the-chatbot-works.md#adding-a-new-connection) for
the general connection-adding steps, then duplicate the connection or tool
file into the subagent's own `connections/` or `tools/` folder.

## Choosing Where To Publish

Before calling `ideation`, the orchestrator decides the destination — Notion,
Linear, or Shortcut. If the user already stated a preference, it uses that.
Otherwise it asks once with `ask_question` and reuses that same destination
for every deliverable in the run.

The orchestrator's instructions are explicit that it asks **at most one
question, ever**: the destination question is the only one asked before
drafting starts. It does not also ask which stage to start with or whether
the user has existing materials — it makes a reasonable default call
(always start with `ideation`) instead. This constraint exists because the
chat UI can only surface and resolve one open `ask_question` at a time;
asking a second one before the first is answered would leave the user stuck.

## Publishing A Deliverable

After each stage returns, the orchestrator publishes its `content`
immediately, before moving to the next stage:

- **Notion**: on the first deliverable, find or create a parent page named
  after the project; publish every later deliverable as a page nested under
  that parent.
- **Linear**: on the first deliverable, find the right team (asking the user
  if more than one is plausible) and create a Project named after the
  initiative; publish each deliverable as an issue attached to that Project.
- **Shortcut**: on the first deliverable, find the right workflow (asking if
  ambiguous) and create an Epic named after the initiative; publish each
  deliverable as a Story under that Epic.

The orchestrator records the URL/identifier each publish call returns, both
to thread forward into later stages' `message` and for the final recap.

## Finishing

Once `management-plans` is published, the orchestrator replies with a short
recap: the project name and a link to every deliverable produced. It does not
paste full deliverable content back into the chat — the published
pages/issues are the source of truth.

## Current Scope

The pipeline stops after Management Plans. It does not attempt baselines
(WBS, schedule, cost, risk register), execution outputs,
monitoring/controlling outputs, or closing deliverables — those stages don't
exist yet. If a user asks for something past Management Plans, the
orchestrator says so rather than improvising it.

## Extending The Pipeline

To add a new stage:

1. Add `agent/subagents/pmbok-specialist/subagents/<stage>/{agent.ts,instructions.md}`
   following the existing stages' shape (a focused `description`, a
   `definePerUserModel` model, and instructions that only draft — no
   publishing).
2. Update the orchestrator's `instructions.md` pipeline order, including
   which prior stage(s) feed it and whether it can run in parallel with
   another stage.
3. Add publishing logic for the new deliverable type to the "Publishing a
   deliverable" section, for each of Notion/Linear/Shortcut.
4. If the new stage needs its own connection or tool, declare it inside the
   subagent's own folder — see "Nested Subagents Don't Inherit Connections"
   above.
