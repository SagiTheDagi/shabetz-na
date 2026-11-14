/**
 * Shared date helpers.
 *
 * All conversions are timezone-safe: dates are treated as calendar dates in
 * local time and formatted manually. Never use `toISOString()` on a locally
 * constructed Date — it shifts the day for anyone east/west of UTC.
 */

export const HEBREW_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

/** Hebrew month name (and common variants) -> 1-based month number. */
export const HEBREW_MONTH_TO_NUMBER: Record<string, number> = {
  ינואר: 1,
  פברואר: 2,
  מרץ: 3,
  מרס: 3,
  אפריל: 4,
  מאי: 5,
  יוני: 6,
  יולי: 7,
  אוגוסט: 8,
  ספטמבר: 9,
  אוקטובר: 10,
  נובמבר: 11,
  דצמבר: 12,
};

/** Hebrew weekday name -> JS getDay() index (0 = Sunday). */
export const HEBREW_WEEKDAY_TO_INDEX: Record<string, number> = {
  ראשון: 0,
  שני: 1,
  שלישי: 2,
  רביעי: 3,
  חמישי: 4,
  שישי: 5,
  שבת: 6,
};

/** Format a Date as YYYY-MM-DD using local calendar fields. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD into a local-midnight Date. */
export function fromIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Build a local-midnight Date, returning null if the calendar date is invalid. */
export function makeDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  // Rejects overflow like 31/02 -> 03/03
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/** A real YYYY-MM-DD calendar date ("2026-02-30" is rejected). */
export function isIsoDate(s: string): boolean {
  // Pure arithmetic: no Date, so no timezone and no 19xx mapping of years < 100.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return days !== undefined && d >= 1 && d <= days;
}

/** Inclusive list of ISO dates from start to end. Empty if end < start. */
export function enumerateDates(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const cur = fromIsoDate(startIso);
  const end = fromIsoDate(endIso);
  while (cur.getTime() <= end.getTime()) {
    out.push(toIsoDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Inclusive day count between two ISO dates. */
export function daysBetween(startIso: string, endIso: string): number {
  const ms = fromIsoDate(endIso).getTime() - fromIsoDate(startIso).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Thursday, Friday or Saturday. */
export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 4 || day === 5 || day === 6;
}

/** DD/MM/YYYY for display. */
export function toDisplayDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** DD/MM for compact display. */
export function toShortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Hebrew weekday name for an ISO date. */
export function hebrewDayName(iso: string): string {
  return HEBREW_DAYS[fromIsoDate(iso).getDay()];
}
