# Feature Plan: AI Insights Assistant (עוזר תובנות)

Status: **draft, decisions locked, review applied** · Created: 2026-11-13 · Revised: 2026-11-13

## Goal

Admin chat assistant that answers natural-language questions about scheduling data
("כמה משמרות סופ"ש עשה כל עובד השנה?", "מי לא שובץ ברבעון הזה?", "הצג התפלגות זמינות לפי דרגה")
with **interactive charts, tables, and short Hebrew text**. Useful results can be **saved as views**
and reopened later with fresh data.

## Decisions

| Topic | Decision |
|---|---|
| LLM | Claude Haiku 5.5 (`claude-haiku-5-5`) via official `@anthropic-ai/sdk`, pay-per-use ($0.10 / $0.50 per MTok up to 100K input tokens, $0.50 / $2.50 above; about $0.002 per question) |
| Data access | **Hybrid**: typed domain tools first; read-only SQL over whitelisted `ai_*` views as fallback |
| Chart data | **By reference.** Query tools return a `result_id`; render tools reference it. The model never copies rows |
| Charts | **Recharts** via the shadcn/ui `chart` component, using theme tokens |
| Chat UI | **assistant-ui** `LocalRuntime` + custom `ChatModelAdapter` → our API route |
| Access | **All admins** (existing admin proxy gate; no extra flag) |
| Chat history | **Not persisted.** Chat is in-memory and lost on reload, so the DB holds no conversation logs |
| Saved views | **Shared** between all admins; `created_by` kept for attribution, and any admin can delete |
| Budget | **Hard cap $5/month**, enforced server-side with reservations, with an Anthropic Console spend limit as backup |

## Architecture

```
/admin/insights (client)
  assistant-ui Thread  ──POST /api/insights/chat (NDJSON stream)──▶  route handler (server, admin-only)
        ▲                                                              │ budget reserve
        │  text deltas + tool-call parts (chart/table specs + data)    ▼
        │                                                     Anthropic SDK tool-use loop
        │                                                       (claude-haiku-5-5)
        │                                                              │ tool calls
        │                                                              ▼
  Recharts renderer ◀── spec + rows ──  src/lib/insights/tools.ts
                         (server joins     ├─ domain query tools (read-only conn) → result_id
                          result_id→rows)  ├─ run_readonly_sql (ai_* views only)  → result_id
                                           ├─ ResultStore (in-memory, result_id → {source, rows})
                                           └─ render_chart / render_table (spec + result_id)
```

### Server: `src/app/api/insights/chat/route.ts`
- **Admin-only:** add `/api/insights` to `adminApiPrefixes` in `src/proxy.ts` (the default for `/api/*` is login-only), and re-check `session.is_admin` in the handler.
- **Budget reservation** (see [Budget](#budget-srclibinsightsbudgetts)): reserve before each model call; if it doesn't fit, return 429 with the Hebrew error "חרגת מתקציב העוזר החודשי" (or end the turn with that message if it's mid-loop).
- **SDK tool loop:** `client.messages.stream(...)` → execute tools → feed results back → repeat. Cap at 8 iterations. Settle the reservation after each call.
- **Stop reasons:** handle every `stop_reason`, not only `end_turn`:
  - `tool_use` → run tools, continue.
  - `end_turn` → done.
  - `max_tokens` → stream the partial text plus the Hebrew notice "התשובה נקטעה, נסה לשאול שאלה ממוקדת יותר".
  - `refusal` → Hebrew error "העוזר לא יכול לענות על שאלה זו" (Haiku 5.5 has no server-side fallback).
  - Iteration cap hit → Hebrew notice "השאלה מורכבת מדי, נסה לפצל אותה".
- **Abort:** pass `req.signal` to the SDK stream and check it between tool calls. On abort, stop the loop and still settle the reservation with the tokens already used.
- **Streams NDJSON events:** text deltas, `tool_call` (for a "querying…" indicator), and `tool_result` (chart/table spec **with rows joined server-side** from the ResultStore).
- **Prompt and cache layout** (Haiku 5.5 caches prefixes of 512 tokens or more):
  - `tools` then `system`: fully static (schema summary, domain glossary covering quarter, shift vs reserve, weekend rule, exemption; answer-in-Hebrew instruction). One `cache_control` breakpoint at the end of `system`.
  - Dynamic context (today's date, current quarter id, admin's selected quarter) goes in a mid-conversation `{ role: "system" }` message after the latest user message, never in top-level `system`.
- **History sent to the model:** the client sends the full thread, but the server rebuilds it compactly:
  - Text turns are kept as-is.
  - Each chart/table part is replaced by a short summary (`[chart: <title>, result_id=…, 42 rows]`); rows are never re-sent.
  - Keep the last 10 turns, and trim further if the estimate (chars ÷ 3) exceeds 50K tokens. This keeps every request under the 100K price tier.
- **`max_tokens`:** 4096 per call (answers are short; data is by reference).
- **`output_config.effort`:** chosen by the eval in phase 2 (start the sweep at `medium`, the Haiku 5.5 default, then try `low`).
- **Optional feature:** if `ANTHROPIC_API_KEY` is unset, the route returns a Hebrew error and the nav item is hidden. The core app is unaffected.

### Budget: `src/lib/insights/budget.ts`
- **Cost formula** (`src/lib/insights/pricing.ts`, both tiers hardcoded):
  `cost = input × in_price + cache_write × in_price × 1.25 + cache_read × in_price × 0.1 + output × out_price`.
  Use the >100K tier prices when the request's total input exceeds 100K tokens. Thinking tokens arrive as output tokens.
- **Reservation, to stop parallel requests from overshooting:**
  - The app runs as one process, so keep an in-memory `pendingUsd`.
  - Before each model call: `estimate = (prompt_chars ÷ 3) × in_price + max_tokens × out_price`. Allow only if `month_cost + pendingUsd + estimate ≤ 5`; then `pendingUsd += estimate`.
  - After the call (or on abort/error): `pendingUsd -= estimate`, and add the actual cost to `InsightUsage` in one upsert.
  - On restart `pendingUsd` starts at 0, which is correct because nothing is in flight.

### Data access: `src/lib/insights/`
1. **Read-only connection:** a separate `new Database(path, { readonly: true })` with `PRAGMA query_only = 1`, never the writable singleton.
2. **Domain tools** (typed schemas, `strict: true`). Each returns `{ result_id, columns, row_count, preview }`, where `preview` is the first 20 rows so the model can write about the data:
   - `shifts_per_worker({ quarter_id?, from?, to?, shift_type_id?, role? })`
   - `weekend_shifts_per_worker({ year })`
   - `quarter_coverage({ quarter_id })`: assigned / unassigned / reserve-missing per date
   - `availability_summary({ quarter_id, group_by: "rank" | "worker" | "date" })`
   - `justice_chart({ rank_ids? })`: calls `buildChartData` from `src/lib/justice-chart.ts` only. **Never** `recomputeJusticeChart`, which writes to the `JusticeChart` table. The data is as fresh as the last recompute; the tool result says so.
   - `worker_history({ worker_id })`
   - `list_reference({ kind: "ranks" | "shift_types" | "quarters" })`
3. **SQL fallback:** `run_readonly_sql({ sql })`, also returning a `result_id`.
   - Only `ai_*` views (created in a migration); safe columns only, **never** `password_hash`.
   - Guards (one shared function, `guardSql`):
     - single statement;
     - `stmt.readonly === true`;
     - references limited to `ai_*` views;
     - no `WITH RECURSIVE`;
     - automatic `LIMIT 1000`.
   - Read with `stmt.iterate()` and stop at 1000 rows or 512 KB.
   - Time limit: better-sqlite3 has no statement timeout, so run the query in a `worker_threads` worker with its own read-only connection and `terminate()` it after 3 s (Hebrew error "השאילתה ארכה זמן רב מדי").
4. **ResultStore:** in-memory map `result_id → { source: {tool, args}, columns, rows, created_at }`. 1 h TTL, max 200 entries (LRU). Lets a follow-up like "show it as a pie" reuse an earlier result without re-querying. An expired id gets an error telling the model to re-run the query.
5. **Output tools** (no DB access; they define what the UI renders): `render_chart(ChartSpecInput)` and `render_table(TableSpecInput)`. The server validates the spec against the stored columns, joins the rows, and streams the full spec to the client.

### ChartSpec (validated server-side)
```ts
// What the model sends: no data, no source
type ChartSpecInput = {
  result_id: string;
  kind: "bar" | "stacked_bar" | "line" | "area" | "pie" | "heatmap_calendar";
  title: string;                                     // Hebrew
  x: { key: string; label: string; type: "category" | "date" | "number" };
  series: { key: string; label: string }[];          // keys must exist in the result's columns
};

// What the client receives: the server joins rows and source from the ResultStore
type ChartSpec = Omit<ChartSpecInput, "result_id"> & {
  data: Record<string, string | number | null>[];    // ≤ 500 rows, straight from the query
  source: { tool: string; args: unknown };            // re-run for saved views
};
```
The numbers on screen always come from the query, never from the model's output. The renderer maps `kind` to Recharts components, with colors from `--chart-1..5` and RTL-aware axes and tooltips. `heatmap_calendar` is a custom component.

### Client: `src/app/admin/insights/page.tsx`
Runtime verified against the docs for `@assistant-ui/react@0.15.36`:
```tsx
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";

const adapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const res = await fetch("/api/insights/chat", { method: "POST", body: JSON.stringify({ messages }), signal: abortSignal });
    // read NDJSON; keep text + Map<toolCallId, part> OUTSIDE the loop
    // each yield = FULL cumulative content (replaces previous):
    // yield { content: [{ type: "text", text }, ...toolCalls.values()] }
    // tool part: { type: "tool-call", toolCallId, toolName, args, result }
  },
};
const runtime = useLocalRuntime(adapter); // in-memory only, no history adapter
<AssistantRuntimeProvider runtime={runtime}><Thread /></AssistantRuntimeProvider>
```
- Tools run server-side, so the client only renders finished `tool-call` parts: `render_chart` → `<InsightChart>`, `render_table` → `<InsightTable>` (sortable, CSV export).
- `abortSignal` reaches the server through `fetch`, and the route stops the loop (see Server).
- Tool-render API: the docs show `defineToolkit` + `AuiConfig({ tools: Tools({ toolkit }) })` as the provider `config`. Confirm it supports display-only tools (no `execute`) in phase 3.
- `Thread` comes from `npx assistant-ui@latest add thread`, which generates `@/components/assistant-ui/...`. It pulls in `radix-ui` alongside our Base UI; restyle it with project tokens (see Open items).
- "שמור תצוגה" button on each chart and table.
- A monthly budget indicator in the header (e.g. "$1.20 / $5") from `GET /api/insights/usage`.
- Mobile: the same page, responsive, linked from `/admin/more`. RTL: check under `dir="rtl"`.
- Rejected alternative: the DataStream runtime, which couples us to their wire format.

## DB changes (`scripts/migrate.ts`)
```sql
-- shared saved views (data not stored; re-run source for fresh results)
CREATE TABLE IF NOT EXISTS SavedInsight (
  insight_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  question TEXT NOT NULL,
  spec_json TEXT NOT NULL,          -- ChartSpec/TableSpec without data
  source_json TEXT NOT NULL,        -- {tool, args}
  schema_version INTEGER NOT NULL,  -- AI_VIEWS_VERSION at save time
  created_by TEXT NOT NULL REFERENCES Worker(worker_id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- budget: ONE row per month (upsert), no per-request logs
CREATE TABLE IF NOT EXISTS InsightUsage (
  month TEXT PRIMARY KEY,           -- '2026-11'
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0
);

-- plus read-only ai_* views (ai_workers, ai_shifts, ai_assignments, ai_availability, ai_history)
```
- `AI_VIEWS_VERSION` is a constant in `src/lib/insights/views.ts`. Bump it whenever an `ai_*` view or a domain tool's output columns change.
- No chat or message tables, so DB growth is only saved views plus about 12 usage rows per year.

## APIs
- `POST /api/insights/chat`: streamed chat (budget-reserved).
- `GET /api/insights/usage`: the current month's cost and the cap.
- `GET/POST/DELETE /api/insights/saved`: shared list; any admin can create or delete. POST stores `schema_version = AI_VIEWS_VERSION`.
- `GET /api/insights/saved/[id]/data`: re-runs the stored source **without Claude**, so it's free and the data is current.
  - If `schema_version` doesn't match `AI_VIEWS_VERSION`, return 409 with the Hebrew error "התצוגה נשמרה לפני שינוי מבנה הנתונים, יש ליצור אותה מחדש"; the grid shows it as outdated.
  - A `run_readonly_sql` source goes through `guardSql` and the worker timeout again on every re-run; the stored SQL is never trusted.
- `/admin/insights/saved`: a grid of saved views (mini dashboard).

## Privacy & security
- Data sent to Anthropic includes worker names and IDs; API data is not used for training. Document this in `docs/tech-stack.md`.
- Optional `INSIGHTS_PSEUDONYMIZE=true`: names and IDs become aliases before sending and are mapped back before display. The swap covers **everything sent to Anthropic**: the user's message, the rebuilt history, and tool results.
  - **Stable aliases:** alias = `W-` + first 3 hex chars of `HMAC(SESSION_SECRET, worker_id)` (extend to 4+ on collision). Never list order, which shifts when workers are added. The client keeps real names, so the server re-swaps the full history every request, and the same worker must get the same alias on every turn.
  - **Free text excluded:** with the flag on, the `ai_*` views and domain tools omit `notes`, `standing_constraints` and `exemption_reason`. They can name other workers, and exact matching misses nicknames.
  - **Tool inputs:** the model calls tools with aliases (`worker_history({ worker_id: "W-3fa" })`). The server maps them back to real IDs before querying, and stores the real IDs in `source` so saved views don't depend on the alias.
  - **Map back after joining text:** an alias can be split across stream chunks (`W-3` + `fa`). The client replaces aliases on the joined text before rendering, never per chunk. Chart/table rows are replaced per cell.
  - Limit (UI tooltip): exact match only; nicknames and misspellings in the question aren't swapped, so they're sent as typed and can't be linked to the data. Use the worker ID instead.
- Read-only connection (`query_only`) plus whitelisted views; never expose `password_hash`, sessions, or env values.
- Rate limit: N requests per admin per minute (in-memory), plus `max_tokens: 4096` per call.

## Deployment
- `ANTHROPIC_API_KEY` goes in `/etc/shabetz-na/.env` and `.env.example`.
- Outbound HTTPS to `api.anthropic.com` from the container (check the Docker network and VPS firewall).
- Set a $5 monthly spend limit in the Anthropic Console as a backstop.
- Update `docs/DEPLOY.md`, `docs/tech-stack.md`, and the `CLAUDE.md` route list.

## New dependencies
`@anthropic-ai/sdk` · `@assistant-ui/react` (+ markdown pkg) · `recharts` (+ `npx shadcn add chart`) · `zod` (optional, for validation)

## Phases
1. **Foundation:**
   - Read-only connection (`query_only`).
   - `ai_*` views + `SavedInsight` + `InsightUsage` migration.
   - ResultStore, 3–4 domain tools.
   - Tests (`src/lib/__tests__/insights-tools.test.ts`), including one that runs `PRAGMA table_info` on every `ai_*` view and fails if `password_hash` (or any column outside an allowlist) appears.
2. **LLM loop:**
   - Chat route, streaming tool loop, stop-reason handling, abort.
   - System prompt with the cache layout above; compact history rebuild.
   - SQL guard + worker timeout, plus tests: rejects writes, multiple statements, `WITH RECURSIVE` and non-whitelisted tables; times out a slow query.
   - Budget: pricing (both tiers, cache tokens), reservation, usage upsert, plus tests: cost formula, and two concurrent reservations near the cap.
   - **Eval:** `scripts/eval-insights.mjs` runs 15–20 real Hebrew questions against seeded data and compares the numbers in the tool results and final answer to expected values. Run it at `medium` and `low` effort, pick the cheapest that passes, and record the result here. Re-run it after prompt or tool changes.
3. **UI:** `/admin/insights`, assistant-ui `LocalRuntime`, Recharts renderer (bar/line/pie/stacked), table renderer, budget indicator, nav entry.
4. **Saved views:** APIs, `schema_version` check, shared grid page, re-run without the LLM.
5. **Polish:** calendar heatmap, CSV export, pseudonymize flag (stable HMAC aliases, free-text columns dropped, map-back on joined text, plus a test that a worker keeps the same alias across two requests), mobile pass, e2e script (`scripts/e2e-insights.mjs`).

## Open items
- assistant-ui: confirm the display-only tool render API (`defineToolkit` vs `makeAssistantToolUI`) in phase 3.
- assistant-ui's generated `Thread` pulls in `radix-ui` next to Base UI. Decide in phase 3: keep it (restyled) or write our own Thread (~150 lines) on Base UI; the custom adapter works with either.
- Price constants in `src/lib/insights/pricing.ts` (both tiers): update them if Anthropic changes Haiku 5.5 pricing.
