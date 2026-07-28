import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

// Declared separately from agent/connections/notion.ts: subagents don't
// inherit the root's connections, so this reuses the same connector.
const notionConnector = process.env.NOTION_CONNECTOR ?? "notion";

export default defineMcpClientConnection({
  url: "https://mcp.notion.com/mcp",
  description: "Notion workspace: search and edit pages and databases.",
  auth: connect(notionConnector),
});
