import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

// Declared separately from agent/connections/linear.ts: subagents don't
// inherit the root's connections, so this reuses the same connector.
const linearConnector = process.env.LINEAR_CONNECTOR ?? "linear";

export default defineMcpClientConnection({
  url: "https://mcp.linear.app/mcp",
  description:
    "Linear workspace: search and update issues, projects, cycles, comments, and planning work.",
  auth: connect(linearConnector),
});
