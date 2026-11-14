/**
 * In-memory store of query results, keyed by result_id. Query tools put rows
 * here and hand the model only the id; render tools look the rows up again, so
 * numbers on screen always come from the query, never from model output.
 *
 * 1 h TTL, LRU eviction at 200 entries. Map insertion order is the LRU order:
 * get() re-inserts an entry to mark it recently used.
 *
 * Ids are full random UUIDs, and each entry belongs to an owner (the admin's
 * session); get() with another owner behaves like an unknown id.
 */
import { randomUUID } from "crypto";

export type Cell = string | number | null;
export type Row = Record<string, Cell>;
export type ResultSource = { tool: string; args: unknown };

export interface StoredResult {
  source: ResultSource;
  columns: string[];
  rows: Row[];
  created_at: number;
  owner: string;
}

export const RESULT_TTL_MS = 60 * 60 * 1000;
export const RESULT_MAX_ENTRIES = 200;

export class ResultStore {
  private entries = new Map<string, StoredResult>();

  constructor(
    private now: () => number = Date.now,
    private ttlMs = RESULT_TTL_MS,
    private maxEntries = RESULT_MAX_ENTRIES,
  ) {}

  put(result: Omit<StoredResult, "created_at" | "owner">, owner = ""): string {
    let id: string;
    do id = `r_${randomUUID()}`;
    while (this.entries.has(id));
    this.entries.set(id, { ...result, created_at: this.now(), owner });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    return id;
  }

  /** null if unknown, expired, or owned by someone else. Marks the entry as recently used. */
  get(id: string, owner = ""): StoredResult | null {
    const entry = this.entries.get(id);
    if (!entry || entry.owner !== owner) return null;
    if (this.now() - entry.created_at > this.ttlMs) {
      this.entries.delete(id);
      return null;
    }
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }

  get size(): number {
    return this.entries.size;
  }
}

// One store per server process; survives Next dev hot reloads.
const g = globalThis as unknown as { __insightsResultStore?: ResultStore };
export function getResultStore(): ResultStore {
  return (g.__insightsResultStore ??= new ResultStore());
}
