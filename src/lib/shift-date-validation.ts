/** Pure helpers for validating a single ShiftDate edit (no DB/IO). */
import { isIsoDate } from "./date-utils";

export interface ShiftDateDraft {
  date: string;
  shift_type_id: string;
}

export interface ShiftDateSibling extends ShiftDateDraft {
  shift_date_id: string;
}

export type ShiftDateIssue = "invalid_date" | "out_of_range" | "duplicate" | null;

export function isWeekendDate(iso: string): boolean {
  const day = new Date(iso + "T12:00:00").getDay();
  return day === 4 || day === 5 || day === 6;
}

export function validateShiftDate(
  draft: ShiftDateDraft,
  quarter: { start_date: string; end_date: string },
  siblings: ShiftDateSibling[],
  editingId?: string | null
): ShiftDateIssue {
  if (!isIsoDate(draft.date)) return "invalid_date";
  if (draft.date < quarter.start_date || draft.date > quarter.end_date) return "out_of_range";
  if (
    siblings.some(
      (s) => s.shift_date_id !== editingId && s.date === draft.date && s.shift_type_id === draft.shift_type_id
    )
  ) {
    return "duplicate";
  }
  return null;
}

export const SHIFT_DATE_ISSUE_MESSAGES: Record<Exclude<ShiftDateIssue, null>, string> = {
  invalid_date: "תאריך לא תקין",
  out_of_range: "התאריך מחוץ לטווח הרבעון",
  duplicate: "כבר קיימת משמרת מסוג זה בתאריך זה",
};
