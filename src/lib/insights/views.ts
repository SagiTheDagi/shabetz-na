/**
 * Read-only `ai_*` views exposed to the insights assistant's SQL fallback, and
 * the insights tables. Applied by scripts/migrate.ts (and by tests).
 *
 * Views carry structured columns only: never password_hash, phone, or free
 * text (notes, standing_constraints, exemption_reason, force_reason,
 * availability note), which can name other workers.
 *
 * Bump AI_VIEWS_VERSION whenever a view or a domain tool's output columns
 * change: saved views made against the old shape then return 409.
 *
 * `is_weekend` everywhere here follows the app's weekend rule (weekend-rule.ts:
 * GUARD shifts never count), same as ShiftHistory.was_weekend.
 * `is_weekend_date` is the raw calendar flag.
 */
import type { Database } from "better-sqlite3";
import { getDb } from "../db";
import { weekendRuleSql } from "../weekend-rule";

export const AI_VIEWS_VERSION = 2;

const VIEWS: Record<string, string> = {
  ai_workers: `
    SELECT w.worker_id, w.name, w.rank_id, r.name AS rank_name,
           w.is_admin, w.is_exempt, w.receives_shift_allocation, w.is_archived,
           w.release_date, w.branch, w.team
    FROM Worker w JOIN Rank r ON r.rank_id = w.rank_id`,
  ai_shifts: `
    SELECT sd.shift_date_id, sd.quarter_id, sd.date, sd.shift_type_id,
           st.name AS shift_type_name, ${weekendRuleSql("sd")} AS is_weekend, sd.is_weekend AS is_weekend_date
    FROM ShiftDate sd JOIN ShiftType st ON st.shift_type_id = sd.shift_type_id`,
  ai_assignments: `
    SELECT sa.assignment_id, sa.shift_date_id, sd.quarter_id, sd.date, sd.shift_type_id,
           ${weekendRuleSql("sd")} AS is_weekend, sd.is_weekend AS is_weekend_date, sa.worker_id, sa.role, sa.is_forced, sa.assigned_by, sa.assigned_at
    FROM ShiftAssignment sa JOIN ShiftDate sd ON sd.shift_date_id = sa.shift_date_id`,
  ai_availability: `
    SELECT wa.worker_id, wa.quarter_id, wa.date, wa.status, wa.source
    FROM WorkerAvailability wa`,
  ai_history: `
    SELECT sh.history_id, sh.worker_id, sh.quarter_id, sh.shift_date_id, sd.date,
           sd.shift_type_id, sh.was_weekend
    FROM ShiftHistory sh JOIN ShiftDate sd ON sd.shift_date_id = sh.shift_date_id`,
};

export const AI_VIEW_NAMES = Object.keys(VIEWS);

/** Every column each view may expose. The view security test enforces this. */
export const AI_VIEW_COLUMN_ALLOWLIST: Record<string, readonly string[]> = {
  ai_workers: ["worker_id", "name", "rank_id", "rank_name", "is_admin", "is_exempt",
    "receives_shift_allocation", "is_archived", "release_date", "branch", "team"],
  ai_shifts: ["shift_date_id", "quarter_id", "date", "shift_type_id", "shift_type_name", "is_weekend", "is_weekend_date"],
  ai_assignments: ["assignment_id", "shift_date_id", "quarter_id", "date", "shift_type_id",
    "is_weekend", "is_weekend_date", "worker_id", "role", "is_forced", "assigned_by", "assigned_at"],
  ai_availability: ["worker_id", "quarter_id", "date", "status", "source"],
  ai_history: ["history_id", "worker_id", "quarter_id", "shift_date_id", "date", "shift_type_id", "was_weekend"],
};

export const INSIGHT_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS SavedInsight (
    insight_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    question TEXT NOT NULL,
    spec_json TEXT NOT NULL,
    source_json TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    -- SET NULL: removing an admin must not be blocked by (or delete) shared views.
    created_by TEXT REFERENCES Worker(worker_id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS InsightUsage (
    month TEXT PRIMARY KEY,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0
  );
`;

/** Idempotent: (re)creates every ai_* view and the insights tables. Also run by scripts/migrate.ts. */
export function applyInsightsSchema(db: Database): void {
  db.transaction(() => {
    for (const [name, sql] of Object.entries(VIEWS)) {
      db.exec(`DROP VIEW IF EXISTS ${name}`);
      db.exec(`CREATE VIEW ${name} AS ${sql}`);
    }
    db.exec(INSIGHT_TABLES_SQL);
  })();
}

const REQUIRED_OBJECTS = [...AI_VIEW_NAMES, "SavedInsight", "InsightUsage"];

// The runtime image can't run scripts/migrate.ts (no tsx, no src/), so the
// app applies the insights schema itself. It (re)creates everything once per
// process (views may have changed with the code), then only re-applies when an
// object is missing, e.g. after a DB restored from an older backup.
const g = globalThis as unknown as { __insightsSchemaApplied?: boolean };
export function ensureInsightsSchema(): void {
  const db = getDb();
  if (g.__insightsSchemaApplied) {
    const present = db
      .prepare(`SELECT COUNT(*) FROM sqlite_master WHERE name IN (${REQUIRED_OBJECTS.map(() => "?").join(",")})`)
      .pluck()
      .get(...REQUIRED_OBJECTS) as number;
    if (present === REQUIRED_OBJECTS.length) return;
  }
  applyInsightsSchema(db);
  g.__insightsSchemaApplied = true;
}
