import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

// Declared separately from agent/connections/shortcut.ts: subagents don't
// inherit the root's connections, so this reuses the same connector.
const shortcutConnector = process.env.SHORTCUT_CONNECTOR ?? "shortcut";

export default defineMcpClientConnection({
  url: "https://mcp.shortcut.com/mcp",
  description: "Shortcut workspace: manage stories, tasks, and projects.",
  // See agent/connections/shortcut.ts: Shortcut's OAuth server requires a
  // non-empty `scope` param, which Connect only sends when tokenParams is set.
  auth: connect({ connector: shortcutConnector, tokenParams: { scopes: ["*"] } }),
});
