import Database from "better-sqlite3";
import path from "path";
import bcrypt from "bcrypt";

const dbPath =
  process.env.DATABASE_PATH ||
  path.join(
    process.env.HOME || process.env.USERPROFILE || ".",
    ".shabetz-na",
    "shabetz.db"
  );

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

console.log(`Seeding database at: ${dbPath}`);

const ranks = [
  { rank_id: "AO", name: "קצין אקדמאי", display_order: 1 },
  { rank_id: "AAO", name: "קצין אקדמאי מתקדם", display_order: 2 },
  { rank_id: "NOL1", name: "לא-קצין רמה 1", display_order: 3 },
  { rank_id: "NOL2", name: "לא-קצין רמה 2", display_order: 4 },
  { rank_id: "OL1", name: "קצין רמה 1", display_order: 5 },
  { rank_id: "OL2", name: "קצין רמה 2", display_order: 6 },
  { rank_id: "OL3", name: "קצין רמה 3", display_order: 7 },
  { rank_id: "OL4", name: "קצין רמה 4", display_order: 8 },
];

const shiftTypes = [
  { shift_type_id: "OFFICER", name: "משמרת קצין", display_order: 1 },
  { shift_type_id: "NON_OFFICER", name: "משמרת לא-קצין", display_order: 2 },
  { shift_type_id: "GUARD", name: "תורנות שמירה", display_order: 3 },
  { shift_type_id: "COMMANDER", name: "משמרת מפקד", display_order: 4 },
];

// Eligibility matrix: [rank_id, shift_type_id, priority]
const eligibility: [string, string, number | null][] = [
  ["AO", "NON_OFFICER", null],
  ["AAO", "NON_OFFICER", null],
  ["AAO", "GUARD", null],
  ["NOL1", "NON_OFFICER", null],
  ["NOL1", "GUARD", null],
  ["NOL2", "NON_OFFICER", null],
  ["NOL2", "GUARD", null],
  ["OL1", "OFFICER", null],
  ["OL1", "NON_OFFICER", null],
  ["OL1", "GUARD", null],
  ["OL2", "OFFICER", null],
  ["OL2", "NON_OFFICER", null],
  ["OL2", "GUARD", null],
  ["OL3", "OFFICER", null],
  ["OL3", "NON_OFFICER", null],
  ["OL3", "GUARD", 2],
  ["OL3", "COMMANDER", 1],
  ["OL4", "OFFICER", null],
  ["OL4", "NON_OFFICER", null],
  ["OL4", "GUARD", 2],
  ["OL4", "COMMANDER", 1],
];

const insertRank = db.prepare(
  "INSERT OR IGNORE INTO Rank (rank_id, name, display_order) VALUES (?, ?, ?)"
);
const insertShiftType = db.prepare(
  "INSERT OR IGNORE INTO ShiftType (shift_type_id, name, display_order) VALUES (?, ?, ?)"
);
const insertEligibility = db.prepare(
  "INSERT OR IGNORE INTO RankShiftEligibility (rank_id, shift_type_id, priority) VALUES (?, ?, ?)"
);

const seedAll = db.transaction(() => {
  for (const r of ranks) {
    insertRank.run(r.rank_id, r.name, r.display_order);
  }
  console.log(`Seeded ${ranks.length} ranks.`);

  for (const s of shiftTypes) {
    insertShiftType.run(s.shift_type_id, s.name, s.display_order);
  }
  console.log(`Seeded ${shiftTypes.length} shift types.`);

  for (const [rankId, shiftTypeId, priority] of eligibility) {
    insertEligibility.run(rankId, shiftTypeId, priority);
  }
  console.log(`Seeded ${eligibility.length} eligibility entries.`);
});

seedAll();

// Create or update default admin user
const pepper = process.env.PEPPER_SECRET || "";
const defaultPassword = "admin123";
const hash = bcrypt.hashSync(pepper + defaultPassword, 12);

const adminExists = db.prepare("SELECT worker_id FROM Worker WHERE worker_id = 'admin'").get();
if (adminExists) {
  db.prepare("UPDATE Worker SET password_hash = ? WHERE worker_id = 'admin'").run(hash);
  console.log('Updated admin password hash with current pepper');
} else {
  db.prepare(
    "INSERT INTO Worker (worker_id, name, rank_id, is_admin, password_hash) VALUES (?, ?, ?, ?, ?)"
  ).run("admin", "מנהל מערכת", "OL4", 1, hash);
  console.log('Created default admin user: worker_id="admin", password="admin123"');
}

console.log("Seed complete.");
db.close();
