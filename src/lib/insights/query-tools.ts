/**
 * Every query tool, shared by the chat loop (what the model may call) and saved
 * views (what a saved source may name). Separate from tools.ts because
 * sql-runner imports tools.ts.
 */
import { DOMAIN_TOOLS, type QueryTool } from "./tools";
import { runReadonlySql } from "./sql-runner";

export const QUERY_TOOLS: QueryTool[] = [...DOMAIN_TOOLS, runReadonlySql];
export const QUERY_TOOL_MAP = new Map(QUERY_TOOLS.map((t) => [t.name, t]));
