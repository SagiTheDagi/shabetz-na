import { NextResponse } from "next/server";
import { getDb } from "./db";
import { AuthError } from "./auth";
import { ValidationError } from "./validation";

type Handler<A extends unknown[]> = (...args: A) => Promise<Response>;

/** Maps ValidationError -> 400 and AuthError -> its status; rethrows anything else. */
export function withApiErrors<A extends unknown[]>(handler: Handler<A>): Handler<A> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof ValidationError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      if (e instanceof AuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
  };
}

// Table/column names below are always code constants, never user input.

/** INSERT a row unless `id` exists (409), then respond 201 with the created row. */
export function insertOrConflict(opts: {
  table: string;
  idColumn: string;
  row: Record<string, unknown>;
  conflictMessage: string;
}): NextResponse {
  const { table, idColumn, row, conflictMessage } = opts;
  const db = getDb();
  const id = row[idColumn];
  if (db.prepare(`SELECT 1 FROM ${table} WHERE ${idColumn} = ?`).get(id)) {
    return NextResponse.json({ error: conflictMessage }, { status: 409 });
  }
  const cols = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
  ).run(...Object.values(row));
  const created = db.prepare(`SELECT * FROM ${table} WHERE ${idColumn} = ?`).get(id);
  return NextResponse.json(created, { status: 201 });
}

/** UPDATE by id; 404 if no row changed, else respond with the updated row. */
export function updateOrNotFound(opts: {
  table: string;
  idColumn: string;
  id: string;
  set: Record<string, unknown>;
  notFoundMessage: string;
}): NextResponse {
  const { table, idColumn, id, set, notFoundMessage } = opts;
  const db = getDb();
  const cols = Object.keys(set);
  const result = db
    .prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${idColumn} = ?`)
    .run(...Object.values(set), id);
  if (result.changes === 0) {
    return NextResponse.json({ error: notFoundMessage }, { status: 404 });
  }
  const updated = db.prepare(`SELECT * FROM ${table} WHERE ${idColumn} = ?`).get(id);
  return NextResponse.json(updated);
}

/** DELETE by id; 404 if no row removed. */
export function deleteOrNotFound(opts: {
  table: string;
  idColumn: string;
  id: string;
  notFoundMessage: string;
}): NextResponse {
  const { table, idColumn, id, notFoundMessage } = opts;
  const result = getDb().prepare(`DELETE FROM ${table} WHERE ${idColumn} = ?`).run(id);
  if (result.changes === 0) {
    return NextResponse.json({ error: notFoundMessage }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
