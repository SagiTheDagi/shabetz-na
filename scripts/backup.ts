import path from "path";
import fs from "fs";

const dbPath =
  process.env.DATABASE_PATH ||
  path.join(
    process.env.HOME || process.env.USERPROFILE || ".",
    ".shabetz-na",
    "shabetz.db"
  );

if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found: ${dbPath}`);
  process.exit(1);
}

const dir = path.dirname(dbPath);
const backupDir = path.join(dir, "backups");
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupPath = path.join(backupDir, `shabetz_${timestamp}.db`);

fs.copyFileSync(dbPath, backupPath);
console.log(`Backup created: ${backupPath}`);
