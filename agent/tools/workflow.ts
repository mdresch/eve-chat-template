// Opts into the experimental `Workflow` tool: the model can write JS that
// orchestrates parallel/sequential calls to its own subagents (the built-in
// `agent` copy-of-root, or declared subagents such as pmbok-specialist) as
// one durable step. See eve's dynamic-workflows guide.
import { experimental_workflow } from "eve/tools";

export default experimental_workflow();
