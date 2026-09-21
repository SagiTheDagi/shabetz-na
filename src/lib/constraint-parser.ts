/**
 * Parses free-text Hebrew availability constraints (as submitted through the
 * Google Forms "אילוצים" column) into structured, per-date entries.
 *
 * Pure module: no DB, no I/O. Everything it needs arrives as arguments so it
 * can be exercised directly against real submissions in tests.
 *
 * Design notes:
 *  - Polarity is BLOCK-SCOPED. A header line ("תאריכים שלא אוכל בהם:") sets the
 *    polarity for the lines beneath it, until a blank line or the next header.
 *    A single submission may legitimately contain both negative and positive
 *    blocks, so polarity is resolved per block rather than per submission.
 *  - Date patterns are matched most-specific-first and consumed spans are
 *    masked out, so " - " resolves correctly as either a range separator
 *    ("1.7 - 3.7") or a reason separator ("1.7 - מבחן") without special-casing.
 *  - Anything not confidently understood is preserved in `leftover` rather than
 *    guessed at. The admin review step is the safety net.
 */

import {
  HEBREW_MONTH_TO_NUMBER,
  HEBREW_WEEKDAY_TO_INDEX,
  daysBetween,
  enumerateDates,
  fromIsoDate,
  makeDate,
  toIsoDate,
} from "./date-utils";

// ---- Public types ----

export type ConstraintPolarity = "unavailable" | "prefer_not_work" | "prefer_work";

export type ConstraintFlagKind =
  | "long_range"
  | "very_long_range"
  | "overruns_quarter"
  | "outside_quarter"
  | "reversed_range"
  | "whole_month"
  | "open_ended";

export type ConstraintFlagSeverity = "info" | "warning" | "error";

export interface ConstraintFlag {
  kind: ConstraintFlagKind;
  severity: ConstraintFlagSeverity;
  message: string;
}

export interface ConstraintChip {
  /** ISO dates, already clamped to the quarter. May be empty if fully outside. */
  dates: string[];
  /** First/last date as understood BEFORE clamping. */
  rawStart: string;
  rawEnd: string;
  /** Inclusive span in days, before clamping. */
  spanDays: number;
  /** The exact text that produced this chip. */
  matchedText: string;
  /** Trailing free text on the same line ("חתונה", "מבחן בתואר"). */
  reason: string;
  isRange: boolean;
  flags: ConstraintFlag[];
}

export interface ConstraintBlock {
  /** The header line that scoped this block, if any. */
  headerText: string | null;
  polarity: ConstraintPolarity;
  /** false = no marker found, fell back to the default. */
  polarityDetected: boolean;
  chips: ConstraintChip[];
}

export interface ParsedConstraints {
  blocks: ConstraintBlock[];
  /** Weekday indices (0=Sun) for recurring constraints -> standing_constraints. */
  recurringWeekdays: number[];
  recurringText: string | null;
  /** Lines we could not confidently interpret. */
  leftover: string[];
  /** Union of every date across every chip. */
  allDates: string[];
}

export interface QuarterBounds {
  start_date: string; // ISO
  end_date: string; // ISO
}

export interface ParseOptions {
  /** Status applied when a block has no polarity marker. */
  defaultPolarity?: ConstraintPolarity;
  /**
   * Restrict output to dates that actually have a shift. When omitted, every
   * calendar date inside the quarter is eligible.
   */
  shiftDates?: string[];
}

// ---- Polarity markers (order matters: most specific first) ----

const POSITIVE_MARKERS: RegExp[] = [
  /אשמח\s+לשמור/,
  /אשמח\s+לקחת/,
  /מעדיף\s+לעבוד/,
  /רוצה\s+לעבוד/,
  /מעוניין\s+לעבוד/,
];

/** "I'm free" is the ABSENCE of a constraint, not a request. Suppresses chips. */
const AVAILABLE_MARKERS: RegExp[] = [/פנוי/, /אני\s+זמין/];

const NEGATIVE_SOFT_MARKERS: RegExp[] = [
  /עדיף\s+שלא/,
  /מעדיף\s+לא/,
  /אם\s+אפשר\s+לא/,
  /אשמח\s+להתחשבות/,
  /יהיה\s+קשה/,
];

const NEGATIVE_HARD_MARKERS: RegExp[] = [
  /לא\s+אוכל/,
  /לא\s+יכול/,
  /לא\s+זמין/,
  /לא\s+אהיה/,
  /תאריכים\s+שלא/,
  /אילוצ/,
];

/** Words that make a month reference non-literal ("last week of September"). */
const VAGUE_QUALIFIERS = /שבוע|שאר|אמצע|תחילת|סוף|במהלך|תקופת|בערך|לקראת/;

// ---- Date patterns ----
// Tried in this order; each match is masked out before the next pass runs.

/** 30.7-3.8 · 29/07-01/08 · 1.7 - 3.7 · 9.8 עד 3.9 */
const FULL_RANGE_RE =
  /(\d{1,2})\s*[./]\s*(\d{1,2})(?:\s*[./]\s*(\d{2,4}))?\s*(?:[-–—]|עד)\s*(\d{1,2})\s*[./]\s*(\d{1,2})(?:\s*[./]\s*(\d{2,4}))?/g;

/** 13-15.8 · 07-08/07 · 5-12.7 — month lives only on the right side */
const DAY_RANGE_RE = /(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*[./]\s*(\d{1,2})(?:\s*[./]\s*(\d{2,4}))?/g;

/** 11.7 · 30.06 · 12/07 */
const SINGLE_RE = /(\d{1,2})\s*[./]\s*(\d{1,2})(?:\s*[./]\s*(\d{2,4}))?/g;

const MONTH_RE = new RegExp(
  `[במלה]?(${Object.keys(HEBREW_MONTH_TO_NUMBER).join("|")})`,
  "g"
);

const WEEKDAY_RE = new RegExp(
  `[והבמל]?(${Object.keys(HEBREW_WEEKDAY_TO_INDEX).join("|")})`,
  "g"
);

const RECURRING_CONTEXT = /ימי|ימים|כל\s+יום/;

// ---- Thresholds ----

const LONG_RANGE_DAYS = 15;
const VERY_LONG_RANGE_DAYS = 30;

// ---- Helpers ----

function normalize(text: string): string {
  return text
    .replace(/\u00A0/g, " ")
    .replace(/[״”“]/g, '"')
    .replace(/[׳’‘]/g, "'")
    .replace(/\r\n?/g, "\n");
}

/** Replace [start,end) with spaces so later passes skip it. */
function mask(s: string, start: number, end: number): string {
  return s.slice(0, start) + " ".repeat(end - start) + s.slice(end);
}

function stripReason(raw: string): string {
  return raw
    // Brackets left empty once the date inside them was masked out.
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:;,.()]+/, "")
    .replace(/[\s\-–—:;,.]+$/, "")
    .trim();
}

/**
 * Resolve a bare day+month to a full date. Tries the quarter's start year
 * first, then the neighbouring years (for quarters that straddle Jan 1).
 */
function inferYear(
  day: number,
  month: number,
  quarter: QuarterBounds
): { iso: string; outside: boolean } | null {
  const startYear = fromIsoDate(quarter.start_date).getFullYear();
  const endYear = fromIsoDate(quarter.end_date).getFullYear();

  const candidates = Array.from(new Set([startYear, endYear, startYear + 1, startYear - 1]));

  for (const year of candidates) {
    const d = makeDate(year, month, day);
    if (!d) continue;
    const iso = toIsoDate(d);
    if (iso >= quarter.start_date && iso <= quarter.end_date) {
      return { iso, outside: false };
    }
  }

  const fallback = makeDate(startYear, month, day);
  if (!fallback) return null;
  return { iso: toIsoDate(fallback), outside: true };
}

function buildChip(
  startIso: string,
  endIso: string,
  matchedText: string,
  reason: string,
  isRange: boolean,
  quarter: QuarterBounds,
  eligible: Set<string> | null,
  extraFlags: ConstraintFlag[] = []
): ConstraintChip {
  const flags: ConstraintFlag[] = [...extraFlags];

  if (endIso < startIso) {
    flags.push({
      kind: "reversed_range",
      severity: "error",
      message: "טווח הפוך — תאריך הסיום לפני תאריך ההתחלה",
    });
    return {
      dates: [],
      rawStart: startIso,
      rawEnd: endIso,
      spanDays: 0,
      matchedText,
      reason,
      isRange,
      flags,
    };
  }

  const spanDays = daysBetween(startIso, endIso);

  if (spanDays > VERY_LONG_RANGE_DAYS) {
    flags.push({
      kind: "very_long_range",
      severity: "error",
      message: `טווח ארוך מאוד (${spanDays} ימים) — ודא שאינו שגיאת פענוח`,
    });
  } else if (spanDays >= LONG_RANGE_DAYS) {
    flags.push({
      kind: "long_range",
      severity: "warning",
      message: `טווח ארוך (${spanDays} ימים) — מומלץ לאמת`,
    });
  }

  const clampedStart = startIso < quarter.start_date ? quarter.start_date : startIso;
  const clampedEnd = endIso > quarter.end_date ? quarter.end_date : endIso;

  if (endIso > quarter.end_date && startIso <= quarter.end_date) {
    flags.push({
      kind: "overruns_quarter",
      severity: "warning",
      message: "חורג מסוף הרבעון — נקטע לגבול הרבעון",
    });
  }

  if (endIso < quarter.start_date || startIso > quarter.end_date) {
    flags.push({
      kind: "outside_quarter",
      severity: "warning",
      message: "מחוץ לטווח הרבעון — לא ייובא",
    });
    return {
      dates: [],
      rawStart: startIso,
      rawEnd: endIso,
      spanDays,
      matchedText,
      reason,
      isRange,
      flags,
    };
  }

  let dates = enumerateDates(clampedStart, clampedEnd);
  if (eligible) dates = dates.filter((d) => eligible.has(d));

  return { dates, rawStart: startIso, rawEnd: endIso, spanDays, matchedText, reason, isRange, flags };
}

interface RawMatch {
  start: number;
  end: number;
  startIso: string;
  endIso: string;
  text: string;
  isRange: boolean;
  outside: boolean;
}

/** Pull every date token out of a line, most-specific pattern first. */
function extractDateMatches(line: string, quarter: QuarterBounds): RawMatch[] {
  const matches: RawMatch[] = [];
  let working = line;

  const collect = (
    re: RegExp,
    handler: (m: RegExpExecArray) => { startIso: string; endIso: string; outside: boolean } | null
  ) => {
    re.lastIndex = 0;
    const found: Array<{ m: RegExpExecArray; parsed: NonNullable<ReturnType<typeof handler>> }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(working)) !== null) {
      const parsed = handler(m);
      if (parsed) found.push({ m, parsed });
    }
    for (const { m, parsed } of found) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        startIso: parsed.startIso,
        endIso: parsed.endIso,
        text: m[0].trim(),
        isRange: parsed.startIso !== parsed.endIso,
        outside: parsed.outside,
      });
      working = mask(working, m.index, m.index + m[0].length);
    }
  };

  collect(FULL_RANGE_RE, (m) => {
    const a = inferYear(Number(m[1]), Number(m[2]), quarter);
    const b = inferYear(Number(m[4]), Number(m[5]), quarter);
    if (!a || !b) return null;
    return { startIso: a.iso, endIso: b.iso, outside: a.outside && b.outside };
  });

  collect(DAY_RANGE_RE, (m) => {
    const month = Number(m[3]);
    const a = inferYear(Number(m[1]), month, quarter);
    const b = inferYear(Number(m[2]), month, quarter);
    if (!a || !b) return null;
    return { startIso: a.iso, endIso: b.iso, outside: a.outside && b.outside };
  });

  collect(SINGLE_RE, (m) => {
    const a = inferYear(Number(m[1]), Number(m[2]), quarter);
    if (!a) return null;
    return { startIso: a.iso, endIso: a.iso, outside: a.outside };
  });

  matches.sort((x, y) => x.start - y.start);
  return matches;
}

function detectPolarity(
  line: string
): { polarity: ConstraintPolarity; available: boolean } | null {
  for (const re of POSITIVE_MARKERS) {
    if (re.test(line)) return { polarity: "prefer_work", available: false };
  }
  for (const re of NEGATIVE_SOFT_MARKERS) {
    if (re.test(line)) return { polarity: "prefer_not_work", available: false };
  }
  for (const re of NEGATIVE_HARD_MARKERS) {
    if (re.test(line)) return { polarity: "unavailable", available: false };
  }
  for (const re of AVAILABLE_MARKERS) {
    if (re.test(line)) return { polarity: "prefer_work", available: true };
  }
  return null;
}

function extractWeekdays(line: string): number[] {
  if (!RECURRING_CONTEXT.test(line)) return [];
  WEEKDAY_RE.lastIndex = 0;
  const days = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = WEEKDAY_RE.exec(line)) !== null) {
    const idx = HEBREW_WEEKDAY_TO_INDEX[m[1]];
    if (idx !== undefined) days.add(idx);
  }
  return Array.from(days).sort((a, b) => a - b);
}

/** Month names, with the index at which each was mentioned. */
function extractMonths(line: string): Array<{ month: number; index: number }> {
  MONTH_RE.lastIndex = 0;
  const out: Array<{ month: number; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = MONTH_RE.exec(line)) !== null) {
    const month = HEBREW_MONTH_TO_NUMBER[m[1]];
    if (month) out.push({ month, index: m.index });
  }
  return out;
}

function monthDateRange(month: number, quarter: QuarterBounds): { start: string; end: string } | null {
  const startYear = fromIsoDate(quarter.start_date).getFullYear();
  const endYear = fromIsoDate(quarter.end_date).getFullYear();
  for (const year of Array.from(new Set([startYear, endYear]))) {
    const first = makeDate(year, month, 1);
    if (!first) continue;
    const last = new Date(year, month, 0);
    const startIso = toIsoDate(first);
    const endIso = toIsoDate(last);
    if (endIso >= quarter.start_date && startIso <= quarter.end_date) {
      return { start: startIso, end: endIso };
    }
  }
  return null;
}

function isHeaderLine(line: string, hasDates: boolean, hasMonths: boolean): boolean {
  if (/[:;]\s*$/.test(line)) return true;
  // A line carrying its own dates or month names is a constraint, not a header,
  // even when it also contains a polarity marker ("יולי לא יכול בכלל").
  return !hasDates && !hasMonths && detectPolarity(line) !== null;
}

// ---- Main entry point ----

export function parseConstraints(
  text: string,
  quarter: QuarterBounds,
  options: ParseOptions = {}
): ParsedConstraints {
  const defaultPolarity = options.defaultPolarity ?? "unavailable";
  const eligible = options.shiftDates ? new Set(options.shiftDates) : null;

  const blocks: ConstraintBlock[] = [];
  const leftover: string[] = [];
  const recurringWeekdays = new Set<number>();
  let recurringText: string | null = null;

  if (!text || !text.trim()) {
    return { blocks: [], recurringWeekdays: [], recurringText: null, leftover: [], allDates: [] };
  }

  const lines = normalize(text).split("\n");

  let current: ConstraintBlock = {
    headerText: null,
    polarity: defaultPolarity,
    polarityDetected: false,
    chips: [],
  };

  const flushBlock = () => {
    if (current.chips.length > 0) blocks.push(current);
  };

  const startBlock = (headerText: string | null, polarity: ConstraintPolarity, detected: boolean) => {
    flushBlock();
    current = { headerText, polarity, polarityDetected: detected, chips: [] };
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Blank line closes the current block and resets polarity.
    if (!line) {
      startBlock(null, defaultPolarity, false);
      continue;
    }

    // Recurring weekday rules belong in standing_constraints, not per-date rows.
    const weekdays = extractWeekdays(line);
    if (weekdays.length > 0) {
      weekdays.forEach((d) => recurringWeekdays.add(d));
      recurringText = recurringText ? `${recurringText}\n${line}` : line;
      continue;
    }

    const dateMatches = extractDateMatches(line, quarter);
    const months = extractMonths(line);
    const polarityHit = detectPolarity(line);

    // Header line: scopes the lines that follow.
    if (isHeaderLine(line, dateMatches.length > 0, months.length > 0)) {
      startBlock(
        line,
        polarityHit ? polarityHit.polarity : defaultPolarity,
        polarityHit !== null
      );
      if (polarityHit?.available) leftover.push(line);
      continue;
    }

    // "I'm free in August" — availability, not a request. Never emit rows.
    if (polarityHit?.available) {
      leftover.push(line);
      continue;
    }

    const linePolarity = polarityHit ? polarityHit.polarity : current.polarity;
    const linePolarityDetected = polarityHit !== null || current.polarityDetected;

    // An inline marker that disagrees with the block opens a new block.
    if (polarityHit && polarityHit.polarity !== current.polarity && current.chips.length > 0) {
      startBlock(current.headerText, linePolarity, true);
    } else if (polarityHit) {
      current.polarity = linePolarity;
      current.polarityDetected = linePolarityDetected;
    }

    // Reason = whatever text remains once the date tokens are removed.
    let residue = line;
    for (const dm of dateMatches) residue = mask(residue, dm.start, dm.end);
    const reason = stripReason(residue);

    const openEnded = /(^|\s)עד\s*ה?\d/.test(line) && dateMatches.every((d) => !d.isRange);

    if (dateMatches.length > 0) {
      for (const dm of dateMatches) {
        const extraFlags: ConstraintFlag[] = [];
        if (openEnded) {
          extraFlags.push({
            kind: "open_ended",
            severity: "warning",
            message: 'נוסח פתוח ("עד ...") — ודא את טווח התאריכים',
          });
        }
        current.chips.push(
          buildChip(
            dm.startIso,
            dm.endIso,
            dm.text,
            reason,
            dm.isRange,
            quarter,
            eligible,
            extraFlags
          )
        );
      }
      continue;
    }

    // No numeric dates — fall back to month names.
    if (months.length > 0) {
      const vague = line.search(VAGUE_QUALIFIERS);
      const literal = vague === -1 ? months : months.filter((mo) => mo.index < vague);

      for (const mo of literal) {
        const range = monthDateRange(mo.month, quarter);
        if (!range) continue;
        current.chips.push(
          buildChip(range.start, range.end, line, reason, true, quarter, eligible, [
            { kind: "whole_month", severity: "info", message: "חודש שלם — אשר פעם אחת" },
          ])
        );
      }

      if (literal.length < months.length || vague !== -1) leftover.push(line);
      continue;
    }

    // Nothing recognised.
    leftover.push(line);
  }

  flushBlock();

  const allDates = new Set<string>();
  for (const b of blocks) for (const c of b.chips) for (const d of c.dates) allDates.add(d);

  return {
    blocks,
    recurringWeekdays: Array.from(recurringWeekdays).sort((a, b) => a - b),
    recurringText,
    leftover,
    allDates: Array.from(allDates).sort(),
  };
}

/**
 * Share of the quarter's shift dates blocked by negative constraints.
 * Positive (prefer_work) entries are excluded — they don't reduce availability.
 */
export function computeCoverage(
  parsed: ParsedConstraints,
  shiftDates: string[]
): { blocked: number; total: number; pct: number } {
  const total = shiftDates.length;
  if (total === 0) return { blocked: 0, total: 0, pct: 0 };

  const shiftSet = new Set(shiftDates);
  const blockedSet = new Set<string>();

  for (const block of parsed.blocks) {
    if (block.polarity === "prefer_work") continue;
    for (const chip of block.chips) {
      for (const d of chip.dates) if (shiftSet.has(d)) blockedSet.add(d);
    }
  }

  const blocked = blockedSet.size;
  return { blocked, total, pct: Math.round((blocked / total) * 100) };
}
