import { getDb } from "./db";
import type {
  AssignmentWarning,
  Worker,
  ShiftDate,
  WorkerAvailability,
  RankShiftEligibility,
  ShiftAssignment,
  ShiftHistory,
} from "./types";

export function getWorkerWarnings(
  workerId: string,
  shiftDateId: string
): AssignmentWarning[] {
  const db = getDb();
  const warnings: AssignmentWarning[] = [];

  const worker = db
    .prepare("SELECT * FROM Worker WHERE worker_id = ?")
    .get(workerId) as Worker | undefined;
  if (!worker) return warnings;

  const shiftDate = db
    .prepare("SELECT * FROM ShiftDate WHERE shift_date_id = ?")
    .get(shiftDateId) as ShiftDate | undefined;
  if (!shiftDate) return warnings;

  // Check exempt
  if (worker.is_exempt) {
    warnings.push({
      type: "exempt",
      severity: "red",
      message: `עובד פטור: ${worker.exemption_reason || "ללא סיבה"}`,
    });
  }

  // Check eligibility
  const eligibility = db
    .prepare(
      "SELECT * FROM RankShiftEligibility WHERE rank_id = ? AND shift_type_id = ?"
    )
    .get(worker.rank_id, shiftDate.shift_type_id) as
    | RankShiftEligibility
    | undefined;

  if (!eligibility) {
    warnings.push({
      type: "ineligible",
      severity: "red",
      message: "העובד לא כשיר לסוג משמרת זה",
    });
  }

  // Check availability
  const availability = db
    .prepare(
      "SELECT * FROM WorkerAvailability WHERE worker_id = ? AND quarter_id = ? AND date = ?"
    )
    .get(workerId, shiftDate.quarter_id, shiftDate.date) as
    | WorkerAvailability
    | undefined;

  if (availability?.status === "unavailable") {
    warnings.push({
      type: "unavailable",
      severity: "red",
      message: "העובד הגיש שלא יכול ביום זה",
    });
  } else if (availability?.status === "prefer_not_work") {
    warnings.push({
      type: "prefer_not",
      severity: "orange",
      message: "העובד מעדיף לא לעבוד ביום זה",
    });
  }

  // Check already assigned this quarter
  const existingAssignment = db
    .prepare(
      `SELECT sa.assignment_id FROM ShiftAssignment sa
       JOIN ShiftDate sd ON sd.shift_date_id = sa.shift_date_id
       WHERE sa.worker_id = ? AND sd.quarter_id = ?`
    )
    .get(workerId, shiftDate.quarter_id) as
    | { assignment_id: string }
    | undefined;

  if (existingAssignment) {
    warnings.push({
      type: "already_assigned_quarter",
      severity: "amber",
      message: "העובד כבר שובץ ברבעון זה",
    });
  }

  // Check weekend limit (max 1 per year)
  if (shiftDate.is_weekend) {
    const year = shiftDate.date.substring(0, 4);
    const weekendCount = db
      .prepare(
        `SELECT COUNT(*) as count FROM ShiftHistory
         WHERE worker_id = ? AND was_weekend = 1
         AND quarter_id LIKE ?`
      )
      .get(workerId, `${year}-%`) as { count: number };

    if (weekendCount.count > 0) {
      warnings.push({
        type: "weekend_limit",
        severity: "red",
        message: "העובד כבר ביצע משמרת סופ\"ש השנה",
      });
    }
  }

  return warnings;
}

export function getSortedWorkers(shiftDateId: string): {
  worker_id: string;
  name: string;
  rank_id: string;
  rank_name: string;
  is_exempt: number;
  warnings: AssignmentWarning[];
  days_since_last_shift: number | null;
  assigned_this_quarter: boolean;
  availability_status: string | null;
  eligibility_priority: number | null;
  is_eligible: boolean;
}[] {
  const db = getDb();

  const shiftDate = db
    .prepare(
      `SELECT sd.*, st.name as shift_type_name
       FROM ShiftDate sd
       JOIN ShiftType st ON st.shift_type_id = sd.shift_type_id
       WHERE sd.shift_date_id = ?`
    )
    .get(shiftDateId) as (ShiftDate & { shift_type_name: string }) | undefined;

  if (!shiftDate) return [];

  const workers = db
    .prepare(
      `SELECT w.*, r.name as rank_name
       FROM Worker w
       JOIN Rank r ON r.rank_id = w.rank_id
       ORDER BY r.display_order, w.name`
    )
    .all() as (Worker & { rank_name: string })[];

  const results = workers.map((worker) => {
    const warnings = getWorkerWarnings(worker.worker_id, shiftDateId);

    // Eligibility
    const elig = db
      .prepare(
        "SELECT priority FROM RankShiftEligibility WHERE rank_id = ? AND shift_type_id = ?"
      )
      .get(worker.rank_id, shiftDate.shift_type_id) as
      | { priority: number | null }
      | undefined;

    // Availability for this date
    const avail = db
      .prepare(
        "SELECT status FROM WorkerAvailability WHERE worker_id = ? AND quarter_id = ? AND date = ?"
      )
      .get(worker.worker_id, shiftDate.quarter_id, shiftDate.date) as
      | { status: string }
      | undefined;

    // Already assigned this quarter
    const assigned = db
      .prepare(
        `SELECT sa.assignment_id FROM ShiftAssignment sa
         JOIN ShiftDate sd ON sd.shift_date_id = sa.shift_date_id
         WHERE sa.worker_id = ? AND sd.quarter_id = ?`
      )
      .get(worker.worker_id, shiftDate.quarter_id) as
      | { assignment_id: string }
      | undefined;

    // Days since last shift
    const lastShift = db
      .prepare(
        `SELECT MAX(sd.date) as last_date
         FROM ShiftHistory sh
         JOIN ShiftDate sd ON sd.shift_date_id = sh.shift_date_id
         WHERE sh.worker_id = ?`
      )
      .get(worker.worker_id) as { last_date: string | null };

    let daysSince: number | null = null;
    if (lastShift?.last_date) {
      const last = new Date(lastShift.last_date);
      const now = new Date(shiftDate.date);
      daysSince = Math.floor(
        (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    return {
      worker_id: worker.worker_id,
      name: worker.name,
      rank_id: worker.rank_id,
      rank_name: worker.rank_name,
      is_exempt: worker.is_exempt,
      warnings,
      days_since_last_shift: daysSince,
      assigned_this_quarter: !!assigned,
      availability_status: avail?.status || null,
      eligibility_priority: elig?.priority ?? null,
      is_eligible: !!elig,
    };
  });

  // Sort: eligible first, then by availability, priority, days since last, not assigned, preference
  results.sort((a, b) => {
    // 1. Non-exempt before exempt
    if (a.is_exempt !== b.is_exempt) return a.is_exempt - b.is_exempt;
    // 2. Eligible before ineligible
    if (a.is_eligible !== b.is_eligible) return a.is_eligible ? -1 : 1;
    // 3. Available before unavailable
    const aUnavail = a.availability_status === "unavailable" ? 1 : 0;
    const bUnavail = b.availability_status === "unavailable" ? 1 : 0;
    if (aUnavail !== bUnavail) return aUnavail - bUnavail;
    // 4. Priority (lower number = higher priority, null last)
    const aPri = a.eligibility_priority ?? 999;
    const bPri = b.eligibility_priority ?? 999;
    if (aPri !== bPri) return aPri - bPri;
    // 5. Not assigned this quarter first
    if (a.assigned_this_quarter !== b.assigned_this_quarter)
      return a.assigned_this_quarter ? 1 : -1;
    // 6. More days since last shift first
    const aDays = a.days_since_last_shift ?? 9999;
    const bDays = b.days_since_last_shift ?? 9999;
    if (aDays !== bDays) return bDays - aDays;
    // 7. Preference: prefer_work > null > prefer_not_work
    const prefOrder = (s: string | null) =>
      s === "prefer_work" ? 0 : s === null ? 1 : 2;
    return prefOrder(a.availability_status) - prefOrder(b.availability_status);
  });

  return results;
}
