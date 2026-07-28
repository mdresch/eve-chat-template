import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

// ATLASSIAN_CONNECTOR is the UID returned by Vercel Connect.
// For local setup, create a connector with:
// `vercel connect create https://mcp.atlassian.com/v1/mcp/authv2 --name atlassian`
const atlassianConnector = process.env.ATLASSIAN_CONNECTOR ?? "atlassian";

export default defineMcpClientConnection({
  // Atlassian's endpoint is versioned; the bare "/mcp" path 404s. "authv2"
  // is Atlassian's documented endpoint for OAuth 2.1 clients (what Vercel
  // Connect brokers here). See https://mcp.atlassian.com — "/v1/mcp" (no
  // authv2) and the legacy "/v1/sse" also exist if this one misbehaves.
  url: "https://mcp.atlassian.com/v1/mcp/authv2",
  description:
    "Atlassian workspace: manage Jira issues, Confluence pages, and projects.",
  auth: connect(atlassianConnector),
});
