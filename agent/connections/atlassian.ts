import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

// ATLASSIAN_CONNECTOR is the UID returned by Vercel Connect.
// For local setup, create a connector with:
// `vercel connect create https://mcp.atlassian.com/mcp --name atlassian`
const atlassianConnector = process.env.ATLASSIAN_CONNECTOR ?? "atlassian";

export default defineMcpClientConnection({
  url: "https://mcp.atlassian.com/mcp", // Atlassian's MCP endpoint
  description:
    "Atlassian workspace: manage Jira issues, Confluence pages, and projects.",
  auth: connect(atlassianConnector),
});
