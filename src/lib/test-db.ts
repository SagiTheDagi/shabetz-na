/**
 * Test-only: points the getDb() singleton at an in-memory SQLite DB with the
 * production schema. Import this BEFORE anything that imports ./db.
 * node:test runs each file in its own process, so the singleton is per-file.
 */
process.env.DATABASE_PATH = ":memory:";

import { getDb } from "./db";

const SCHEMA = `
  CREATE TABLE Rank (rank_id TEXT PRIMARY KEY, name TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE ShiftType (shift_type_id TEXT PRIMARY KEY, name TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE RankShiftEligibility (
    rank_id TEXT NOT NULL REFERENCES Rank(rank_id) ON DELETE CASCADE,
    shift_type_id TEXT NOT NULL REFERENCES ShiftType(shift_type_id) ON DELETE CASCADE,
    priority INTEGER, PRIMARY KEY (rank_id, shift_type_id));
  CREATE TABLE Worker (
    worker_id TEXT PRIMARY KEY, name TEXT NOT NULL, rank_id TEXT NOT NULL REFERENCES Rank(rank_id),
    is_admin INTEGER NOT NULL DEFAULT 0, password_hash TEXT,
    is_exempt INTEGER NOT NULL DEFAULT 0, exemption_reason TEXT,
    receives_shift_allocation INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    standing_constraints TEXT, notes TEXT, release_date TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0, branch TEXT, team TEXT, phone TEXT,
    in_whatsapp_group INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE Quarter (quarter_id TEXT PRIMARY KEY, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE ShiftDate (shift_date_id TEXT PRIMARY KEY, quarter_id TEXT NOT NULL REFERENCES Quarter(quarter_id) ON DELETE CASCADE,
    date TEXT NOT NULL, shift_type_id TEXT NOT NULL REFERENCES ShiftType(shift_type_id), is_weekend INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE WorkerAvailability (availability_id TEXT PRIMARY KEY, worker_id TEXT NOT NULL REFERENCES Worker(worker_id) ON DELETE CASCADE,
    quarter_id TEXT NOT NULL, date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('unavailable','prefer_work','prefer_not_work')),
    source TEXT NOT NULL DEFAULT 'worker', note TEXT, UNIQUE(worker_id, quarter_id, date));
  CREATE TABLE ShiftAssignment (assignment_id TEXT PRIMARY KEY, shift_date_id TEXT NOT NULL REFERENCES ShiftDate(shift_date_id) ON DELETE CASCADE,
    worker_id TEXT NOT NULL REFERENCES Worker(worker_id), assigned_by TEXT NOT NULL,
    is_forced INTEGER NOT NULL DEFAULT 0, force_reason TEXT, assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
    role TEXT NOT NULL DEFAULT 'shift');
  CREATE UNIQUE INDEX idx_assignment_shift_role ON ShiftAssignment(shift_date_id, role);
  CREATE TABLE ShiftHistory (history_id TEXT PRIMARY KEY, worker_id TEXT NOT NULL REFERENCES Worker(worker_id) ON DELETE CASCADE,
    quarter_id TEXT NOT NULL, shift_date_id TEXT NOT NULL REFERENCES ShiftDate(shift_date_id) ON DELETE CASCADE,
    was_weekend INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE JusticeChart (worker_id TEXT NOT NULL, shift_type_id TEXT NOT NULL,
    total_shifts INTEGER NOT NULL DEFAULT 0, weekend_shifts INTEGER NOT NULL DEFAULT 0,
    period_start TEXT NOT NULL, period_end TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (worker_id, shift_type_id));
`;

const TABLES = [
  "JusticeChart",   "ShiftHistory", "ShiftAssignment", "WorkerAvailability", "ShiftDate", "Quarter",
  "Worker", "RankShiftEligibility", "ShiftType", "Rank",
];

/** Fresh schema on the singleton connection; call from beforeEach. */
export function resetTestDb() {
  const db = getDb();
  for (const t of TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
  db.exec(SCHEMA);
  return db;
}
