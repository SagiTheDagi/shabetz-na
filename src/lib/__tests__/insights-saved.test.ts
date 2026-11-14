/** Saved insight views (routes called directly against the in-memory DB). */
import "./test-session";
import { resetTestDb } from "./test-db";
import { asUser } from "./test-session";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { applyInsightsSchema, AI_VIEWS_VERSION } from "../insights/views";
import * as saved from "../../app/api/insights/saved/route";
import * as one from "../../app/api/insights/saved/[id]/route";
import * as data from "../../app/api/insights/saved/[id]/data/route";
import { OUTDATED_MESSAGE } from "../insights/saved";

let db: Database.Database;
const call = (fn: unknown, ...a: unknown[]) => (fn as (...x: unknown[]) => Promise<Response>)(...a);
const json = (body: unknown) =>
  new Request("http://x/api/insights/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const p = (id: string) => ({ params: Promise.resolve({ id }) });

const chartBody = (over: Record<string, unknown> = {}) => ({
  kind: "chart",
  title: "משמרות לעובד",
  question: "כמה משמרות?",
  spec: { kind: "bar", title: "x", x: { key: "name", label: "עובד", type: "category" }, series: [{ key: "shifts", label: "משמרות" }] },
  source: { tool: "shifts_per_worker", args: { quarter_id: "2026-Q1" } },
  ...over,
});

let prevKey: string | undefined;
afterEach(() => {
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevKey;
});

beforeEach(async () => {
  prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  db = resetTestDb();
  applyInsightsSchema(db);
  db.exec(`
    INSERT INTO Rank VALUES ('R1','r',1,datetime('now'));
    INSERT INTO ShiftType VALUES ('OFFICER','קצין',1,datetime('now'));
    INSERT INTO Worker (worker_id,name,rank_id,is_admin) VALUES ('1','אבי','R1',1),('2','בני','R1',0);
    INSERT INTO Quarter (quarter_id,start_date,end_date) VALUES ('2026-Q1','2026-01-01','2026-03-31');
    INSERT INTO ShiftDate VALUES ('s1','2026-Q1','2026-01-08','OFFICER',1);
    INSERT INTO ShiftAssignment (assignment_id,shift_date_id,worker_id,assigned_by,role) VALUES ('a1','s1','2','1','shift');
  `);
  await asUser("1", true);
});

describe("/api/insights/saved", () => {
  it("POST stores spec without data + source + schema_version; GET lists with creator", async () => {
    const res = await call(saved.POST, json(chartBody({ spec: { ...chartBody().spec, data: [{ evil: 1 }] } })));
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.title, "משמרות לעובד");
    assert.equal(created.spec.title, "משמרות לעובד");
    assert.equal(created.spec.data, undefined);
    assert.equal(created.schema_version, AI_VIEWS_VERSION);
    const row = db.prepare("SELECT spec_json, created_by FROM SavedInsight").get() as { spec_json: string; created_by: string };
    assert.ok(!row.spec_json.includes("evil"));
    assert.equal(row.created_by, "1");
    const list = await (await call(saved.GET)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].created_by_name, "אבי");
    assert.equal(list[0].kind, "chart");
  });

  it("POST rejects bad specs, unknown tools, bad args and unsafe SQL", async () => {
    assert.equal((await call(saved.POST, json({ title: "" }))).status, 400);
    assert.equal((await call(saved.POST, json(chartBody({ source: { tool: "drop_everything", args: {} } })))).status, 400);
    assert.equal((await call(saved.POST, json(chartBody({ source: { tool: "shifts_per_worker", args: { quarter_id: "bad" } } })))).status, 400);
    assert.equal((await call(saved.POST, json(chartBody({ source: { tool: "run_readonly_sql", args: { sql: "SELECT * FROM Worker" } } })))).status, 400);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM SavedInsight").pluck().get(), 0);
  });

  it("POST rejects specs that can never render (unknown keys, pie with 2 series)", async () => {
    const spec = chartBody().spec;
    assert.equal((await call(saved.POST, json(chartBody({ spec: { ...spec, x: { ...spec.x, key: "nonexistent" } } })))).status, 400);
    const pie = { ...spec, kind: "pie", series: [{ key: "shifts", label: "a" }, { key: "weekend_shifts", label: "b" }] };
    assert.equal((await call(saved.POST, json(chartBody({ spec: pie })))).status, 400);
    const table = { kind: "table", spec: { title: "t", columns: [{ key: "nope", label: "x" }] } };
    assert.equal((await call(saved.POST, json(chartBody(table)))).status, 400);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM SavedInsight").pluck().get(), 0);
  });

  it("503 on every route when the assistant isn't configured", async () => {
    const { insight_id } = await (await call(saved.POST, json(chartBody()))).json();
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal((await call(saved.GET)).status, 503);
    assert.equal((await call(saved.POST, json(chartBody()))).status, 503);
    assert.equal((await call(data.GET, new Request("http://x"), p(insight_id))).status, 503);
    assert.equal((await call(one.DELETE, new Request("http://x"), p(insight_id))).status, 503);
  });

  it("a corrupt row doesn't break the list; it shows as outdated and is deletable", async () => {
    await call(saved.POST, json(chartBody()));
    const { insight_id } = await (await call(saved.POST, json(chartBody({ title: "שבור" })))).json();
    db.prepare("UPDATE SavedInsight SET spec_json = '{not json' WHERE insight_id = ?").run(insight_id);
    const res = await call(saved.GET);
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.equal(list.length, 2);
    assert.equal(list.find((v: { insight_id: string }) => v.insight_id === insight_id).corrupt, true);
    assert.equal((await call(data.GET, new Request("http://x"), p(insight_id))).status, 409);
    assert.equal((await call(one.DELETE, new Request("http://x"), p(insight_id))).status, 200);
  });

  it("non-admin is refused", async () => {
    await asUser("2", false);
    assert.equal((await call(saved.GET)).status, 403);
    assert.equal((await call(saved.POST, json(chartBody()))).status, 403);
  });

  it("DELETE by any admin; 404 when missing", async () => {
    const { insight_id } = await (await call(saved.POST, json(chartBody()))).json();
    db.prepare("UPDATE Worker SET is_admin = 1 WHERE worker_id = '2'").run();
    await asUser("2", true);
    assert.equal((await call(one.DELETE, new Request("http://x"), p(insight_id))).status, 200);
    assert.equal((await call(one.DELETE, new Request("http://x"), p(insight_id))).status, 404);
  });
});

describe("/api/insights/saved/[id]/data", () => {
  it("re-runs the source without the LLM and returns fresh rows", async () => {
    const { insight_id } = await (await call(saved.POST, json(chartBody()))).json();
    let body = await (await call(data.GET, new Request("http://x"), p(insight_id))).json();
    assert.equal(body.kind, "chart");
    assert.equal(body.spec.data.find((r: { name: string }) => r.name === "בני").shifts, 1);
    // new assignment → fresh data on next open
    db.exec(`INSERT INTO ShiftDate VALUES ('s2','2026-Q1','2026-01-20','OFFICER',0);
             INSERT INTO ShiftAssignment (assignment_id,shift_date_id,worker_id,assigned_by,role) VALUES ('a2','s2','2','1','shift');`);
    body = await (await call(data.GET, new Request("http://x"), p(insight_id))).json();
    assert.equal(body.spec.data.find((r: { name: string }) => r.name === "בני").shifts, 2);
  });

  it("a schema_version bump alone doesn't mark a view outdated", async () => {
    const { insight_id } = await (await call(saved.POST, json(chartBody()))).json();
    db.prepare("UPDATE SavedInsight SET schema_version = ?").run(AI_VIEWS_VERSION - 1);
    assert.equal((await call(data.GET, new Request("http://x"), p(insight_id))).status, 200);
  });

  it("409 when the source no longer has the spec's columns, or its args no longer parse", async () => {
    const { insight_id } = await (await call(saved.POST, json(chartBody()))).json();
    const spec = { kind: "chart", spec: { ...chartBody().spec, series: [{ key: "renamed_col", label: "x" }] } };
    db.prepare("UPDATE SavedInsight SET spec_json = ?").run(JSON.stringify(spec));
    let res = await call(data.GET, new Request("http://x"), p(insight_id));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, OUTDATED_MESSAGE);
    db.prepare("UPDATE SavedInsight SET source_json = ?").run(JSON.stringify({ tool: "shifts_per_worker", args: { quarter_id: 5 } }));
    res = await call(data.GET, new Request("http://x"), p(insight_id));
    assert.equal(res.status, 409);
  });

  it("a saved view with tampered SQL is rejected on re-run", async () => {
    // Inserted directly: the isolated SQL runner can't open the in-memory test DB, so POST can't save SQL views here.
    const insight_id = "tampered";
    db.prepare(
      `INSERT INTO SavedInsight (insight_id, title, question, spec_json, source_json, schema_version, created_by) VALUES (?, 't', '', ?, ?, ?, '1')`,
    ).run(
      insight_id,
      JSON.stringify({ kind: "table", spec: { title: "t" } }),
      JSON.stringify({ tool: "run_readonly_sql", args: { sql: "SELECT password_hash FROM Worker" } }),
      AI_VIEWS_VERSION,
    );
    const res = await call(data.GET, new Request("http://x"), p(insight_id));
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.error, "טעינת נתוני התצוגה נכשלה");
    assert.equal(body.detail, undefined, "English guard text stays server-side");
  });

  it("a table saved without columns follows the result's columns on every re-run", async () => {
    const { insight_id } = await (await call(saved.POST, json(chartBody({ kind: "table", spec: { title: "t" } })))).json();
    const body = await (await call(data.GET, new Request("http://x"), p(insight_id))).json();
    assert.equal(body.spec.columns_default, true);
    assert.deepEqual(body.spec.columns.map((c: { key: string }) => c.key), ["worker_id", "name", "rank_name", "shifts", "weekend_shifts"]);
  });

  it("404 for unknown id", async () => {
    assert.equal((await call(data.GET, new Request("http://x"), p("nope"))).status, 404);
  });
});
