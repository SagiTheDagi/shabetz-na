# AI Insights Assistant — Task Breakdown

Companion to [ai-insights-assistant.md](ai-insights-assistant.md).

Each task fits in one PR, lists what it depends on, and says how to tell it's done. Tasks marked ⚠ need review by a senior developer: they cover security, concurrency or the LLM loop.

Verified references: `adminApiPrefixes` in `src/proxy.ts:71`, `buildChartData` in `src/lib/justice-chart.ts:32`, `scripts/migrate.ts`, and the `test-db.ts` helper for tests.

Sizes: S = small, M = medium, L = large.

---

## Phase 0: Setup

### T0.1 Install dependencies and set up env (S)
- `npm i @anthropic-ai/sdk zod recharts`, then `npx shadcn add chart`.
- Add `ANTHROPIC_API_KEY=` and `INSIGHTS_PSEUDONYMIZE=false` to `.env.example`.
- **Done when:** `npm run build` and `npm run lint` both pass.

---

## Phase 1: Foundation (no LLM)

### T1.1 Read-only DB connection (S)
- New `src/lib/insights/readonly-db.ts`: `new Database(DATABASE_PATH, { readonly: true })` plus `PRAGMA query_only = 1`, as a singleton.
- **Test:** any INSERT or UPDATE through it throws.
- **Done when:** the test passes and the writable singleton in `db.ts` is untouched.

### T1.2 Migration for the `ai_*` views (M) ⚠
- In `scripts/migrate.ts`, create `ai_workers`, `ai_shifts`, `ai_assignments`, `ai_availability` and `ai_history`. Use safe columns only.
- New `src/lib/insights/views.ts` holding `AI_VIEWS_VERSION = 1` and `AI_VIEW_COLUMN_ALLOWLIST`.
- **Read first:** `docs/data-model.md` and `src/lib/types.ts`.
- **Done when:** the migration runs twice without errors (`IF NOT EXISTS` / `DROP VIEW IF EXISTS`).

### T1.3 Migration for the `SavedInsight` and `InsightUsage` tables (S)
- Copy the SQL from the plan exactly and add matching types to `types.ts`.
- **Done when:** the migration runs twice without errors.

### T1.4 Security test for the views (S)
- **Depends on:** T1.2.
- New `src/lib/__tests__/insights-tools.test.ts`: run `PRAGMA table_info` on every `ai_*` view. The test fails if `password_hash` appears, or any column that isn't in the allowlist.

### T1.5 ResultStore (M)
- New `src/lib/insights/result-store.ts`: `put({source, columns, rows}) → result_id` and `get(id)`, with a 1 h TTL and LRU eviction at 200 entries.
- Inject the clock so tests can control time.
- **Tests:** an expired entry returns null; the 201st entry evicts the least recently used one; `get` marks an entry as recently used.

### T1.6 Domain tools, batch A (M)
- **Depends on:** T1.1, T1.5.
- New `src/lib/insights/tools.ts` with `list_reference`, `shifts_per_worker` and `weekend_shifts_per_worker`.
- Each tool has a zod/JSON schema (`strict: true`) and returns `{ result_id, columns, row_count, preview (≤20 rows) }`.
- **Tests:** run against `test-db.ts` with known seed data and assert exact counts.

### T1.7 Domain tools, batch B (M)
- **Depends on:** T1.6.
- `quarter_coverage`, `availability_summary` (with `group_by` set to rank, worker or date), `worker_history`, and `justice_chart`.
- `justice_chart` calls `buildChartData` only and never `recomputeJusticeChart`. Its result includes a note on how fresh the data is.
- **Tests:** same approach as T1.6, plus a test that the `JusticeChart` table is unchanged after calling `justice_chart`.

---

## Phase 2: LLM loop (backend)

### T2.1 Pricing module (S)
- New `src/lib/insights/pricing.ts`: both price tiers and `computeCost(usage)` (formula in the plan).
- **Tests:** a fixed usage gives the expected cost, the request switches to the higher tier above 100K input tokens, and the cache-write (×1.25) and cache-read (×0.1) multipliers apply.

### T2.2 Budget reservation (M) ⚠
- **Depends on:** T1.3, T2.1.
- New `src/lib/insights/budget.ts`: `reserve(estimate)` returns `ok` or `over`, and `settle(reservation, actualUsage)` subtracts from `pendingUsd` and upserts `InsightUsage`.
- **Tests:** two parallel reservations near the $5 cap, where only one goes through; settling after an abort still records the actual cost.

### T2.3 SQL guard (M) ⚠
- **Depends on:** T1.2.
- `guardSql(sql)` enforces: one statement only, `stmt.readonly`, only `ai_*` names referenced, no `WITH RECURSIVE`, and `LIMIT 1000` added automatically.
- **Tests:** reject `DELETE`, `a; b`, `WITH RECURSIVE`, `SELECT * FROM Worker` and `sqlite_master`; accept a valid query against `ai_shifts`.

### T2.4 Running SQL in a worker thread with a timeout (M) ⚠
- **Depends on:** T2.3.
- `worker_threads` with its own read-only connection; reads with `iterate()` and stops at 1000 rows or 512 KB; calls `terminate()` after 3 s and returns the Hebrew error from the plan.
- Expose it as the `run_readonly_sql` tool, which returns a `result_id`.
- **Test:** a slow query (e.g. a large cross join) hits the timeout.
- **Risk:** check that the worker file resolves correctly in the Next standalone build.

### T2.5 Render tools (M)
- **Depends on:** T1.5.
- `render_chart` and `render_table`: validate the spec against the stored columns (`x.key` and every `series[].key` must exist), join the rows (≤500), and attach `source`.
- **Tests:** an unknown key returns an error, an expired `result_id` returns an error, and the output contains no `result_id`.

### T2.6 Proxy gate (S)
- Add `/api/insights` to `adminApiPrefixes`.
- Extend `middleware.test.ts`: a non-admin request gets 403.

### T2.7 Prompt and history builder (M)
- New `src/lib/insights/prompt.ts`:
  - static system (glossary from `docs/business-rules.md`, answer in Hebrew) with a `cache_control` breakpoint;
  - the dynamic context goes in a system message after the last user message;
  - history compaction: chart parts become a one-line summary, keep the last 10 turns, and trim if the estimate exceeds 50K tokens.
- **Tests:** these are pure functions, so snapshot the built messages.

### T2.8 Chat route with the tool loop (L) ⚠
- **Depends on:** T1.6, T1.7, T2.2, T2.4, T2.5, T2.6, T2.7.
- `src/app/api/insights/chat/route.ts`:
  - `messages.stream`, executing tools and stopping after 8 iterations;
  - handles every `stop_reason` (Hebrew messages from the plan);
  - `req.signal` abort;
  - NDJSON events: `text`, `tool_call` and `tool_result`;
  - returns a Hebrew error when there's no API key, and checks `is_admin` again.
- **Read first:** `node_modules/next/dist/docs/` on route handlers and streaming.
- **Done when:** curl with a session cookie gets a streamed answer, and an abort mid-stream records the tokens in the usage table.

### T2.9 Usage API (S)
- `GET /api/insights/usage` returns `{ month, cost_usd, cap: 5 }`.

### T2.10 Rate limit (S)
- In-memory limit of N requests per admin per minute. Reuse the pattern from the login rate limiter.

### T2.11 Eval script (M)
- **Depends on:** T2.8.
- `scripts/eval-insights.mjs`: 15–20 Hebrew questions with expected numbers from the seed data. Run it at medium and low effort and record the results in the plan file.
- Get the questions from the product owner (Sagi).

---

## Phase 3: UI

### T3.1 Spike: assistant-ui (S, time-boxed to 1 day)
- Answer the two open items: does `defineToolkit` support display-only tools, and should we keep the generated Thread (radix) or write our own on Base UI?
- **Output:** a short written recommendation, no production code.

### T3.2 Insights page and adapter (L)
- **Depends on:** T2.8, T3.1.
- `src/app/admin/insights/page.tsx`: `useLocalRuntime` plus a `ChatModelAdapter` that parses NDJSON and yields the full cumulative content each time (see the snippet in the plan).
- **Done when:** text streams, the "querying…" indicator shows up, and the stop button cancels the request.

### T3.3 `<InsightChart>` (M)
- **Depends on:** T0.1.
- Recharts components for `bar`, `stacked_bar`, `line`, `area` and `pie`, colored with `--chart-1..5`; check axes and tooltips under RTL.
- Build it on its own with mock specs first, before wiring it into T3.2.

### T3.4 `<InsightTable>` (M)
- Sortable columns. CSV export can wait until phase 5.

### T3.5 Budget indicator and nav (S)
- Show "$x / $5" in the header.
- Add a nav entry on desktop and in `/admin/more`, hidden when there's no API key. This needs a flag from the server.

---

## Phase 4: Saved views

### T4.1 Saved views CRUD API (M)
- `GET`/`POST`/`DELETE /api/insights/saved`; `POST` stores `schema_version`.
- Tests in the style of `crud-routes.test.ts`.

### T4.2 Re-run endpoint (M) ⚠
- `GET /api/insights/saved/[id]/data`: returns 409 when the version doesn't match; re-runs the source by calling the tool directly, with no LLM.
- Saved SQL goes through `guardSql` and the worker timeout again on every re-run.
- **Test:** a saved view with tampered SQL gets rejected.

### T4.3 "שמור תצוגה" button (S)
- On every chart and table: a title prompt, then POST.

### T4.4 Saved views grid page (M)
- `/admin/insights/saved`: cards that fetch `/data`, an "outdated" badge on a 409, and delete.

---

## Phase 5: Polish

| Task | Size | Notes |
|---|---|---|
| T5.1 `heatmap_calendar` component | M | custom component, not Recharts |
| T5.2 CSV export from table | S | UTF-8 BOM so Excel shows the Hebrew correctly |
| T5.3 Pseudonymization ⚠ | L | HMAC aliases with collision extension, drop free-text columns, map aliases back to IDs in tool inputs, client swaps aliases on the joined text; test that an alias stays stable across 2 requests |
| T5.4 Mobile pass | M | `useIsMobile`, check the chat and charts at 375px |
| T5.5 `scripts/e2e-insights.mjs` | M | follow the style of `e2e-workers.mjs` |
| T5.6 Docs | S | `DEPLOY.md` (key, outbound HTTPS, Console spend limit), `tech-stack.md` (privacy), `CLAUDE.md` routes |

---

## Order and parallel work

- **Critical path:** T1.1 → T1.5 → T1.6 → T2.5/T2.7 → T2.8 → T3.2.
- **Can run in parallel:** T2.1–T2.4, T2.6, T3.3 and T3.4 (with mock data) can start early.
- **Start a junior on:** T1.3, T1.5, T2.1, T2.6, T3.3.
- **Leave for last:** T2.8 and T5.3. They are the hardest tasks, so a junior should take them only after the earlier tasks are merged.

---

## Implementation status (2026-11-14)

All tasks implemented except the live parts of T2.11. `npm test`: 410/410 pass; `npm run build` passes; `scripts/e2e-insights.mjs` 24/24 against a seeded test DB (desktop + 375px).

| Task | Status | Notes |
|---|---|---|
| T0.1 | done | `@anthropic-ai/sdk@1.8.0`, `zod@4`, `recharts@3`, shadcn `chart` |
| T1.1–T1.7 | done | `src/lib/insights/{readonly-db,views,result-store,tools}.ts`; tests in `insights-tools.test.ts` |
| T2.1–T2.3 | done | `pricing.ts`, `budget.ts`, `sql-guard.ts` |
| T2.4 | done, **changed** | Child process (`node -e`, SIGKILL after 3 s, empty env) instead of `worker_threads`: `worker.terminate()` cannot interrupt SQLite while it is inside a native step (e.g. `COUNT(*)` over a cross join), so the thread kept burning CPU and the process never exited. Verified working in the standalone build. |
| T2.5–T2.7 | done | `render.ts`, proxy gate (also fixed `middleware.test.ts`, which still imported the removed `src/middleware`), `prompt.ts` |
| T2.8 | done | Loop in `chat-loop.ts` (testable with a fake client), route `api/insights/chat`. Offline-tested; **not yet run against the live API**. |
| T2.9, T2.10 | done | `api/insights/usage` (also returns `enabled`, `pseudonymize`), `rate-limit.ts` (10/min/admin) |
| T2.11 | harness only | `npm run eval:insights` (`scripts/eval-insights.ts`, in-process so effort can be swept). Cases are DRAFTS with SQL-computed expectations; replace with the product owner's questions, then run and record results here. Effort defaults to `medium` (`INSIGHTS_EFFORT` env). |
| T3.1 | done | See recommendation below |
| T3.2–T3.5 | done | `/admin/insights`, `components/insights/*`, nav (desktop sidebar + `/admin/more`, hidden without key) |
| T4.1–T4.4 | done | `saved.ts`, `api/insights/saved[/id[/data]]`, save dialog, `/admin/insights/saved`. DELETE is `DELETE /api/insights/saved/[id]` (matches the other CRUD routes). |
| T5.1, T5.2 | done | `heatmap-calendar.tsx`; CSV with BOM + formula neutralization |
| T5.3 | done | `pseudonymize.ts`; stable HMAC aliases with collision extension, whole-word name matching, alias→id in tool inputs/SQL, alias map sent to the client and applied to joined text |
| T5.4 | done | 375px checked in e2e (no horizontal scroll) |
| T5.5 | done | `npm run test:e2e:insights` (`LIVE=1` adds one real question) |
| T5.6 | done | `DEPLOY.md`, `tech-stack.md`, `CLAUDE.md` (note: all three are gitignored) |

### T3.1 spike recommendation
- `makeAssistantToolUI` (and `defineToolkit`) do support display-only tools.
- But `@assistant-ui/react@0.15.36` itself depends on `radix-ui`, `zustand`, `assistant-cloud` and more, not only the generated Thread.
- **Chosen:** own thread on our stack (`use-insights-chat.ts` + pure `chat-client.ts`, ~250 lines), no new UI deps. The NDJSON wire format was already ours, so the adapter layer bought little.

### Other deviations
- `ai_*` views never expose free text (`notes`, `standing_constraints`, `exemption_reason`, `force_reason`, availability `note`) or `phone`, regardless of the pseudonymize flag.
- `spec_json` stores `{ kind: "chart" | "table", spec }` (a chart spec has its own `kind`).
- System prompt asks for plain text (no Markdown), since the UI renders text as-is.
