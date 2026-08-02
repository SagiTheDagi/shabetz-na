import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath =
  process.env.DATABASE_PATH ||
  path.join(
    process.env.HOME || process.env.USERPROFILE || ".",
    ".shabetz-na",
    "shabetz.db"
  );

const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

console.log(`Migrating database at: ${dbPath}`);

db.exec(`
  CREATE TABLE IF NOT EXISTS Rank (
    rank_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ShiftType (
    shift_type_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS RankShiftEligibility (
    rank_id TEXT NOT NULL REFERENCES Rank(rank_id) ON DELETE CASCADE,
    shift_type_id TEXT NOT NULL REFERENCES ShiftType(shift_type_id) ON DELETE CASCADE,
    priority INTEGER,
    PRIMARY KEY (rank_id, shift_type_id)
  );

  CREATE TABLE IF NOT EXISTS Worker (
    worker_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    rank_id TEXT NOT NULL REFERENCES Rank(rank_id),
    is_admin INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    is_exempt INTEGER NOT NULL DEFAULT 0,
    exemption_reason TEXT,
    receives_shift_allocation INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS Quarter (
    quarter_id TEXT PRIMARY KEY,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'published')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ShiftDate (
    shift_date_id TEXT PRIMARY KEY,
    quarter_id TEXT NOT NULL REFERENCES Quarter(quarter_id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    shift_type_id TEXT NOT NULL REFERENCES ShiftType(shift_type_id),
    is_weekend INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS WorkerAvailability (
    availability_id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL REFERENCES Worker(worker_id) ON DELETE CASCADE,
    quarter_id TEXT NOT NULL REFERENCES Quarter(quarter_id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('unavailable', 'prefer_work', 'prefer_not_work')),
    UNIQUE(worker_id, quarter_id, date)
  );

  CREATE TABLE IF NOT EXISTS ShiftAssignment (
    assignment_id TEXT PRIMARY KEY,
    shift_date_id TEXT NOT NULL REFERENCES ShiftDate(shift_date_id) ON DELETE CASCADE,
    worker_id TEXT NOT NULL REFERENCES Worker(worker_id),
    assigned_by TEXT NOT NULL REFERENCES Worker(worker_id),
    is_forced INTEGER NOT NULL DEFAULT 0,
    force_reason TEXT,
    assigned_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ShiftHistory (
    history_id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL REFERENCES Worker(worker_id) ON DELETE CASCADE,
    quarter_id TEXT NOT NULL REFERENCES Quarter(quarter_id) ON DELETE CASCADE,
    shift_date_id TEXT NOT NULL REFERENCES ShiftDate(shift_date_id) ON DELETE CASCADE,
    was_weekend INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_worker_rank ON Worker(rank_id);
  CREATE INDEX IF NOT EXISTS idx_shiftdate_quarter ON ShiftDate(quarter_id);
  CREATE INDEX IF NOT EXISTS idx_shiftdate_type ON ShiftDate(shift_type_id);
  CREATE INDEX IF NOT EXISTS idx_availability_worker_quarter ON WorkerAvailability(worker_id, quarter_id);
  CREATE INDEX IF NOT EXISTS idx_assignment_shiftdate ON ShiftAssignment(shift_date_id);
  CREATE INDEX IF NOT EXISTS idx_assignment_worker ON ShiftAssignment(worker_id);
  CREATE INDEX IF NOT EXISTS idx_history_worker ON ShiftHistory(worker_id);
  CREATE INDEX IF NOT EXISTS idx_history_quarter ON ShiftHistory(quarter_id);

  CREATE TABLE IF NOT EXISTS JusticeChart (
    worker_id TEXT NOT NULL REFERENCES Worker(worker_id) ON DELETE CASCADE,
    shift_type_id TEXT NOT NULL REFERENCES ShiftType(shift_type_id) ON DELETE CASCADE,
    total_shifts INTEGER NOT NULL DEFAULT 0,
    weekend_shifts INTEGER NOT NULL DEFAULT 0,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (worker_id, shift_type_id)
  );
`);

// Add new columns — safe to re-run, skips if column already exists
for (const sql of [
  "ALTER TABLE Worker ADD COLUMN standing_constraints TEXT",
  "ALTER TABLE Worker ADD COLUMN notes TEXT",
  "ALTER TABLE Worker ADD COLUMN release_date TEXT",
  "ALTER TABLE Worker ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE Worker ADD COLUMN branch TEXT",
  "ALTER TABLE Worker ADD COLUMN team TEXT",
  "ALTER TABLE Worker ADD COLUMN phone TEXT",
  "ALTER TABLE ShiftAssignment ADD COLUMN role TEXT NOT NULL DEFAULT 'shift'",
  "ALTER TABLE JusticeChart ADD COLUMN weekend_shifts INTEGER NOT NULL DEFAULT 0",
]) {
  try {
    db.exec(sql);
    console.log(`Column added: ${sql}`);
  } catch {
    // column already exists
  }
}

// Add unique index on (shift_date_id, role) now that the role column exists
try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_assignment_shift_role ON ShiftAssignment(shift_date_id, role)");
  console.log("Unique index on ShiftAssignment(shift_date_id, role) ensured.");
} catch {
  // index already exists or other non-fatal error
}

// Migrate JusticeChart to composite-PK schema if still on old single-PK schema
try {
  const cols = db.prepare("PRAGMA table_info(JusticeChart)").all() as { name: string }[];
  const hasShiftTypeCol = cols.some((c) => c.name === "shift_type_id");
  if (cols.length > 0 && !hasShiftTypeCol) {
    db.exec("DROP TABLE IF EXISTS JusticeChart");
    db.exec(`
      CREATE TABLE IF NOT EXISTS JusticeChart (
        worker_id TEXT NOT NULL REFERENCES Worker(worker_id) ON DELETE CASCADE,
        shift_type_id TEXT NOT NULL REFERENCES ShiftType(shift_type_id) ON DELETE CASCADE,
        total_shifts INTEGER NOT NULL DEFAULT 0,
        weekend_shifts INTEGER NOT NULL DEFAULT 0,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (worker_id, shift_type_id)
      )
    `);
    console.log("JusticeChart migrated to composite-PK schema.");
  }
} catch {
  // table may not exist yet; main exec block handles it
}

console.log("Migration complete.");
db.close();
