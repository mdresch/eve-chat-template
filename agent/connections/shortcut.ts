import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

// SHORTCUT_CONNECTOR is the UID returned by Vercel Connect.
// For local setup, create a connector with:
// `vercel connect create https://mcp.shortcut.com/mcp --name shortcut`
const shortcutConnector = process.env.SHORTCUT_CONNECTOR ?? "shortcut";

export default defineMcpClientConnection({
  url: "https://mcp.shortcut.com/mcp", // Shortcut's MCP endpoint
  description:
    "Shortcut workspace: manage stories, tasks, and projects.",
  // Shortcut's OAuth server requires a non-empty `scope` param on the
  // authorization request; without tokenParams, Vercel Connect omits it
  // entirely. `["*"]` asks Connect to substitute this connector's
  // registered default scopes rather than a literal "*".
  auth: connect({ connector: shortcutConnector, tokenParams: { scopes: ["*"] } }),
});
