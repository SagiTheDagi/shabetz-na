/**
 * Monthly budget for the insights assistant: hard cap, enforced with
 * reservations so parallel requests can't overshoot.
 *
 * The app is a single process, so in-flight estimates live in memory
 * (pendingUsd). Before each model call reserve(estimate) succeeds only if
 * month_cost + pending + estimate ≤ cap. After the call (or on abort/error)
 * settle() releases the estimate and adds the actual cost to InsightUsage in
 * one upsert. On restart pending starts at 0, which is right: nothing is in
 * flight.
 */
import type { Database } from "better-sqlite3";
import { computeCost, type TokenUsage } from "./pricing";

export const MONTHLY_CAP_USD = 5;
export const BUDGET_EXCEEDED_MESSAGE = "חרגת מתקציב העוזר החודשי";

export interface Reservation {
  estimate: number;
  settled: boolean;
}

export type ReserveResult = { ok: true; reservation: Reservation } | { ok: false; reason: "over" };

export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export class Budget {
  private pendingUsd = 0;

  constructor(
    private db: Database,
    private cap = MONTHLY_CAP_USD,
    private now: () => Date = () => new Date(),
  ) {}

  monthCost(month = currentMonth(this.now())): number {
    const row = this.db.prepare("SELECT cost_usd FROM InsightUsage WHERE month = ?").get(month) as
      | { cost_usd: number }
      | undefined;
    return row?.cost_usd ?? 0;
  }

  get pending(): number {
    return this.pendingUsd;
  }

  /** Synchronous check-and-add: no await between reading the total and reserving. */
  reserve(estimate: number): ReserveResult {
    if (this.monthCost() + this.pendingUsd + estimate > this.cap) return { ok: false, reason: "over" };
    this.pendingUsd += estimate;
    return { ok: true, reservation: { estimate, settled: false } };
  }

  /** Release the reservation and record actual usage. Safe to call once per reservation; extra calls are no-ops. */
  settle(reservation: Reservation, usage: TokenUsage | null): number {
    if (reservation.settled) return 0;
    reservation.settled = true;
    this.pendingUsd = Math.max(0, this.pendingUsd - reservation.estimate);
    if (!usage) return 0;
    const cost = computeCost(usage);
    this.db
      .prepare(
        `INSERT INTO InsightUsage (month, input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(month) DO UPDATE SET
           input_tokens = input_tokens + excluded.input_tokens,
           cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
           cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
           output_tokens = output_tokens + excluded.output_tokens,
           cost_usd = cost_usd + excluded.cost_usd`
      )
      .run(
        currentMonth(this.now()),
        usage.input_tokens,
        usage.cache_creation_input_tokens ?? 0,
        usage.cache_read_input_tokens ?? 0,
        usage.output_tokens,
        cost,
      );
    return cost;
  }
}

// Process-wide budget on the writable connection (usage rows are the only
// thing the assistant writes).
const g = globalThis as unknown as { __insightsBudget?: Budget };
export function getBudget(db: Database): Budget {
  return (g.__insightsBudget ??= new Budget(db));
}
