import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

let db: Database.Database | null = null;

/** DATABASE_PATH, or ~/.shabetz-na/shabetz.db. */
export function resolveDbPath(): string {
  return (
    process.env.DATABASE_PATH ||
    path.join(
      process.env.HOME || process.env.USERPROFILE || ".",
      ".shabetz-na",
      "shabetz.db"
    )
  );
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = resolveDbPath();

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return db;
}
