import * as XLSX from "xlsx";
import type { ParsedShiftDate } from "@/lib/file-parser";
import { HEBREW_DAYS, isWeekend, toIsoDate, toDisplayDate } from "@/lib/date-utils";

function serialToDate(serial: number): Date {
  const info = XLSX.SSF.parse_date_code(serial);
  return new Date(info.y, info.m - 1, info.d);
}

export function parseWeekendRange(s: string): Date | null {
  const yearMatch = s.match(/(\d{4})$/);
  if (!yearMatch) return null;
  const year = parseInt(yearMatch[1]);
  const dotStart = s.match(/^(\d{1,2})\.(\d{1,2})-/);
  if (dotStart) {
    const d = new Date(year, parseInt(dotStart[2]) - 1, parseInt(dotStart[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  const dashStart = s.match(/^(\d{1,2})-/);
  const monthMatch = s.match(/\/(\d{1,2})[-\/]/);
  if (dashStart && monthMatch) {
    const d = new Date(year, parseInt(monthMatch[1]) - 1, parseInt(dashStart[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function parseCsvDate(s: string): Date | null {
  const dmyMatch = s.match(/^(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2,4})$/);
  if (dmyMatch) {
    let year = parseInt(dmyMatch[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, parseInt(dmyMatch[2]) - 1, parseInt(dmyMatch[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const d = new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function makeParsedDate(date: Date, shiftTypeId: string): ParsedShiftDate {
  const isoDate = toIsoDate(date);
  return {
    date: isoDate,
    shift_type_id: shiftTypeId,
    is_weekend: isWeekend(date),
    display_date: toDisplayDate(isoDate),
    day_name: HEBREW_DAYS[date.getDay()],
  };
}

export type RawDate = { date: Date; isWeekend: boolean };
export type SheetGroup = { sheetName: string; dates: RawDate[] };

export function parseSheetDates(rows: unknown[][]): RawDate[] {
  const hasHeader = rows[0]?.[0] === "תאריך";
  const dataStart = hasHeader ? 1 : 0;
  const result: RawDate[] = [];

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const rawDate = row[0];
    if (rawDate == null || rawDate === "") continue;

    let date: Date | null = null;

    if (typeof rawDate === "number") {
      date = serialToDate(rawDate);
    } else if (typeof rawDate === "string") {
      if (/^\d{1,2}[-.]/.test(rawDate)) {
        date = parseWeekendRange(rawDate);
      } else {
        date = parseCsvDate(rawDate);
        if (!date) continue;
      }
    }

    if (!date || isNaN(date.getTime())) continue;
    result.push({ date, isWeekend: isWeekend(date) });
  }

  return result;
}

export function parseXlsxSheets(buffer: ArrayBuffer): SheetGroup[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const groups: SheetGroup[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true }) as unknown[][];
    const dates = parseSheetDates(rows);
    if (dates.length > 0) {
      groups.push({ sheetName, dates });
    }
  }

  return groups;
}

export function parseCsvFile(content: string, defaultShiftTypeId: string): ParsedShiftDate[] {
  const lines = content
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const startIndex = lines.length > 0 && parseCsvDate(lines[0].split(/[,\t]+/)[0]) === null ? 1 : 0;
  const dates: ParsedShiftDate[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const parts = lines[i].split(/[,\t]+/).map((p) => p.trim());
    const date = parseCsvDate(parts[0]);
    if (!date) continue;
    dates.push(makeParsedDate(date, parts[1] || defaultShiftTypeId));
  }

  return dates.sort((a, b) => a.date.localeCompare(b.date));
}
