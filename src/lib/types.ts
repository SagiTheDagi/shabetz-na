export interface Rank {
  rank_id: string;
  name: string;
  display_order: number;
  created_at: string;
}

export interface ShiftType {
  shift_type_id: string;
  name: string;
  display_order: number;
  created_at: string;
}

export interface RankShiftEligibility {
  rank_id: string;
  shift_type_id: string;
  priority: number | null;
}

export interface Worker {
  worker_id: string;
  name: string;
  rank_id: string;
  is_admin: number; // SQLite boolean: 0 or 1
  password_hash: string | null;
  is_exempt: number;
  exemption_reason: string | null;
  receives_shift_allocation: number;
  standing_constraints: string | null;
  notes: string | null;
  release_date: string | null;
  is_archived: number;
  branch: string | null;
  team: string | null;
  created_at: string;
  updated_at: string;
}

export interface Quarter {
  quarter_id: string; // format: 2026-Q1
  start_date: string;
  end_date: string;
  status: "draft" | "in_progress" | "published";
  created_at: string;
}

export interface ShiftDate {
  shift_date_id: string;
  quarter_id: string;
  date: string;
  shift_type_id: string;
  is_weekend: number;
}

export interface WorkerAvailability {
  availability_id: string;
  worker_id: string;
  quarter_id: string;
  date: string;
  status: "unavailable" | "prefer_work" | "prefer_not_work";
}

export interface ShiftAssignment {
  assignment_id: string;
  shift_date_id: string;
  worker_id: string;
  assigned_by: string;
  is_forced: number;
  force_reason: string | null;
  assigned_at: string;
  role: "shift" | "reserve";
}

export interface ShiftHistory {
  history_id: string;
  worker_id: string;
  quarter_id: string;
  shift_date_id: string;
  was_weekend: number;
}

export type AvailabilityStatus = "unavailable" | "prefer_work" | "prefer_not_work";
export type QuarterStatus = "draft" | "in_progress" | "published";

export type WarningSeverity = "green" | "orange" | "amber" | "red";

export interface AssignmentWarning {
  type: string;
  severity: WarningSeverity;
  message: string;
}

export interface WorkerWithRank extends Worker {
  rank_name: string;
}

export interface ShiftDateWithType extends ShiftDate {
  shift_type_name: string;
}

export interface ShiftDateWithAssignment extends ShiftDateWithType {
  assignment_id: string | null;
  assigned_worker_id: string | null;
  assigned_worker_name: string | null;
  is_forced: number | null;
  reserve_assignment_id: string | null;
  reserve_worker_id: string | null;
  reserve_worker_name: string | null;
  reserve_is_forced: number | null;
}

export interface WorkerSuggestion extends WorkerWithRank {
  warnings: AssignmentWarning[];
  days_since_last_shift: number | null;
  assigned_this_quarter: boolean;
  availability_status: AvailabilityStatus | null;
  eligibility_priority: number | null;
  is_eligible: boolean;
}

export interface ExportData {
  version: number;
  exported_at: string;
  ranks: Pick<Rank, "rank_id" | "name" | "display_order">[];
  shift_types: Pick<ShiftType, "shift_type_id" | "name" | "display_order">[];
  eligibility: RankShiftEligibility[];
  quarter: Quarter;
  shift_dates: Omit<ShiftDate, "quarter_id">[];
  assignments: {
    shift_date_id: string;
    worker_id: string;
    is_forced: boolean;
    force_reason: string | null;
    assigned_at: string;
    role: "shift" | "reserve";
  }[];
  worker_availability: {
    worker_id: string;
    date: string;
    status: AvailabilityStatus;
  }[];
}

export interface SessionPayload {
  worker_id: string;
  name: string;
  is_admin: boolean;
}
