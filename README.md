# eve Chat Template

A persisted Next.js chat template for [eve](https://beta.eve.dev), built with shadcn/ui, Tailwind CSS, Streamdown, Better Auth, Drizzle, Neon, and Upstash Redis.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?project-name=eve-chat-template&repository-name=eve-chat-template&repository-url=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Feve-chat-template%2Ftree%2Fmain&env=BETTER_AUTH_SECRET%2CNEXT_PUBLIC_VERCEL_APP_CLIENT_ID%2CVERCEL_APP_CLIENT_SECRET&envDescription=Neon+provisions+DATABASE_URL.+Upstash+Redis+provisions+rate-limit+storage.+Add+Better+Auth+secret+and+Sign+in+with+Vercel+credentials.+After+deploy%2C+run+production+migrations+from+the+setup+guide.&envLink=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Feve-chat-template%2Fblob%2Fmain%2Fdocs%2Fsetup-and-deploy.md&products=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%2C%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22integrationSlug%22%3A%22upstash%22%7D%5D)

## Quick Start

Two ways to get going:

- **One-click:** use the **Deploy with Vercel** button above to clone and provision storage, then run migrations (see [Setup and Deployment](docs/setup-and-deploy.md#one-click-deploy)).
- **Local script:** clone the repo and run the setup script. It links the project, provisions Neon, registers the Sign in with Vercel OAuth app (email scope + callbacks), sets the environment variables through the Vercel API, pulls them locally, runs migrations, and can optionally set up the Notion connector. If OAuth app registration isn't available it falls back to a guided manual flow.

```bash
# Uses the linked project's team by default
./scripts/setup.sh

# Or target a specific team (also accepts a bare team slug)
./scripts/setup.sh --scope <team-slug>
```

The `--scope` is optional; omit it to use the linked project's team. The script needs the `vercel` CLI, `node`, `pnpm`, and `openssl`. Prefer to do it by hand? Follow the sequential steps below, or the full [Setup and Deployment](docs/setup-and-deploy.md) guide.

## Getting Started

For the full local setup, storage provisioning, Sign in with Vercel credentials, and production deploy flow, see [Setup and Deployment](docs/setup-and-deploy.md). For the runtime architecture, streaming model, persistence flow, and extension points, see [How the Chatbot Works](docs/how-the-chatbot-works.md). See the [docs](docs/) folder for feature-specific guides: [per-user AI providers (BYOK)](docs/byok-model-providers.md), [sandboxed code execution](docs/sandboxed-code-execution.md), [the PMBOK specialist subagent](docs/pmbok-specialist-subagent.md), [agent tools and skills](docs/agent-tools-and-skills.md), and [observability](docs/observability.md).

Install dependencies with pnpm:

```bash
pnpm install
```

Link the Vercel project and pull environment variables:

```bash
vercel link
```

Provision storage with the [Vercel CLI integration commands](https://vercel.com/docs/cli/integration):

```bash
# Required: persisted chat, auth, eve session state, and message snapshots
vercel integration add neon

# Required: Redis-backed rate limiting
vercel integration add upstash
```

Follow the prompts to connect each resource to the linked project. Then pull the generated environment variables locally:

```bash
vercel env pull .env.local --yes
```

Required environment variables:

```bash
ANTHROPIC_API_KEY=
DATABASE_URL=
BETTER_AUTH_SECRET=
NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=
VERCEL_APP_CLIENT_SECRET=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
KV_REST_API_URL=
KV_REST_API_TOKEN=
MODEL_KEY_ENCRYPTION_SECRET=
```

`ANTHROPIC_API_KEY` is needed regardless of per-user provider settings: the
root agent's static fallback model and every subagent under
`agent/subagents/` call Anthropic directly. `MODEL_KEY_ENCRYPTION_SECRET`
encrypts per-user AI provider API keys at rest for the `/settings` page (see
[Per-User AI Providers](docs/byok-model-providers.md)); generate it with
`openssl rand -base64 32`.

Optional environment variables:

```bash
# Override the app origin for custom production domains.
BETTER_AUTH_URL=

# Enable hosted Vercel Connect integrations.
SLACK_CONNECTOR=
LINEAR_CONNECTOR=
NOTION_CONNECTOR=
SENTRY_CONNECTOR=
ATLASSIAN_CONNECTOR=
SHORTCUT_CONNECTOR=

# Enables agent/tools/web_search.ts. Get a key at https://exa.ai
EXA_API_KEY=

# Authenticates the sandbox idle-cleanup cron (see vercel.json). Set it on
# the Vercel project too so Vercel Cron sends it automatically.
CRON_SECRET=
```

Create optional Vercel Connect integrations:

```bash
# Slack channel
vercel connect create slack --name eve-chat-template --triggers
vercel connect attach <slack-connector-uid> --triggers --trigger-path /eve/v1/slack --yes

# MCP connections
vercel connect create mcp.notion.com --name notion
vercel connect create https://mcp.linear.app/mcp --name linear
vercel connect create https://mcp.sentry.dev/mcp --name sentry
vercel connect create https://mcp.atlassian.com/v1/mcp/authv2 --name atlassian
vercel connect create https://mcp.shortcut.com/mcp --name shortcut
```

The deploy button does not require these integrations. For manual setup, put the returned connector UIDs in `SLACK_CONNECTOR`, `NOTION_CONNECTOR`, `LINEAR_CONNECTOR`, `SENTRY_CONNECTOR`, `ATLASSIAN_CONNECTOR`, and `SHORTCUT_CONNECTOR`. Local development falls back to `slack/eve-chat-template`, `notion`, `linear`, `sentry`, `atlassian`, and `shortcut`, so connectors created with the names above work without editing `agent/`.

If the connector is not attached to the linked project, run:

```bash
vercel connect attach <connector-uid> --yes
vercel env pull .env.local
```

Create the database tables:

```bash
pnpm db:migrate
```

For production, run migrations with Vercel production env vars:

```bash
vercel env run -e production -- pnpm db:migrate
```

Start the development server:

```bash
pnpm dev
```

## What Is Included

- Text chat with an eve agent through same-origin `/eve/v1/*` routes
- Better Auth sign-in with Vercel
- Mandatory Neon-backed chat history
- Mandatory Upstash Redis rate limiting for authenticated chat sends
- Drizzle schema and migrations under `lib/db`
- Saved eve session cursors and event snapshots
- Sidebar history with delete and new-chat actions
- Vercel Connect-backed Notion, Linear, Sentry, Atlassian, and Shortcut MCP connections
- Vercel Connect-backed Slack channel route at `/eve/v1/slack`
- Composer-level connections menu
- First-message chat titles derived locally from the user's prompt
- Streamdown markdown rendering for assistant text and reasoning
- shadcn/Tailwind components for messages, tools, HITL prompts, and composer
- Per-user AI provider settings (BYOK) with encrypted credentials and automatic fallback ([docs](docs/byok-model-providers.md))
- Docker-backed sandboxed code execution with a `bash` tool, VS Code container attach, and idle cleanup ([docs](docs/sandboxed-code-execution.md))
- A `pmbok-specialist` subagent pipeline that turns an idea into PMBOK deliverables published to Notion, Linear, or Shortcut ([docs](docs/pmbok-specialist-subagent.md))
- Local tools (`bash`, `get_weather`, `web_search`, experimental workflows) and skills ([docs](docs/agent-tools-and-skills.md))
- Sentry error monitoring, structured logs, and custom metrics ([docs](docs/observability.md))

This template intentionally does not include file uploads, Vercel Blob, guest mode, NextAuth/Auth.js, or AI Elements.

## Agent Code

Edit the agent in `agent/agent.ts`. Its behavior is defined in `agent/instructions.md`, and tools live in `agent/tools/`.

The browser talks to eve with `useEveAgent()` from `eve/react`; the app stores eve stream events and session state so `/chat/[id]` can resume the same durable conversation after refresh.
