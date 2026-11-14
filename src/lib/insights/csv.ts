/** CSV for insight tables. UTF-8 BOM so Excel opens the Hebrew correctly. */
import type { Row } from "./result-store";

const BOM = "﻿";

/**
 * A cell's text, shared by the table and the CSV. Rows come from model-written
 * SQL, so a value can be anything JSON can hold (e.g. a serialized BLOB).
 * Empty → "" (the table shows a placeholder instead).
 */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function cell(v: unknown): string {
  if (typeof v === "number") return String(v); // -1e-7 is a number, not a formula
  const s = cellText(v);
  // Neutralize spreadsheet formulas (=, +, -, @, tab, CR at the start) unless it's a plain number.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** `note` (e.g. a truncation warning) goes in a last row of its own, so the file says it's partial. */
export function toCsv(columns: { key: string; label: string }[], rows: Row[], note?: string): string {
  const lines = [columns.map((c) => cell(c.label)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c.key])).join(","));
  if (note) lines.push(cell(note));
  return BOM + lines.join("\r\n") + "\r\n";
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "";

/** Stable sort by one column (Array.prototype.sort is stable); empties last; numbers numerically, text with Hebrew collation. */
export function sortRows(rows: Row[], key: string, dir: "asc" | "desc"): Row[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (isEmpty(x) || isEmpty(y)) return Number(isEmpty(x)) - Number(isEmpty(y));
    return sign * (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "he", { numeric: true }));
  });
}
