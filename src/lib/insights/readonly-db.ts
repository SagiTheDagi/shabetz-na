/**
 * Read-only connection for the insights assistant. Separate from the writable
 * getDb() singleton: opened with { readonly: true } and `query_only`, so even a
 * statement that slips past guardSql cannot write.
 */
import Database from "better-sqlite3";
import { getDb, resolveDbPath } from "../db";
import { ensureInsightsSchema } from "./views";

let ro: Database.Database | null = null;

export function openReadonlyDb(dbPath: string = resolveDbPath()): Database.Database {
  const conn = new Database(dbPath, { readonly: true, fileMustExist: true });
  conn.pragma("query_only = 1");
  return conn;
}

export function getReadonlyDb(): Database.Database {
  ensureInsightsSchema();
  // An in-memory DB (tests only) exists on one connection and can't be
  // reopened read-only, so share the singleton there.
  if (resolveDbPath() === ":memory:") return getDb();
  if (!ro) ro = openReadonlyDb();
  return ro;
}
