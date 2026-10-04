import * as XLSX from "xlsx";

export interface ParsedFormRow {
  id: number;
  timestamp: string;
  name: string;
  branch: string;
  constraints: string;
  workerId: string;
  mode: "append" | "replace";
  included: boolean;
}

export interface WorkerOption {
  worker_id: string;
  name: string;
  notes: string | null;
  standing_constraints: string | null;
}

export function parseFormBuffer(buffer: ArrayBuffer, isCsv: boolean): ParsedFormRow[] {
  const wb = isCsv
    ? XLSX.read(new TextDecoder("utf-8").decode(buffer).replace(/^﻿/, ""), { type: "string" })
    : XLSX.read(buffer, { type: "array" });

  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const raw = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    defval: "",
    raw: false,
  }) as string[][];

  return raw
    .slice(1)
    .filter((r) => String(r[1] ?? "").trim())
    .map((r, i) => ({
      id: i,
      timestamp: String(r[0] ?? "").trim(),
      name: String(r[1] ?? "").trim(),
      branch: String(r[2] ?? "").trim(),
      constraints: String(r[3] ?? "").trim(),
      workerId: "",
      mode: "replace" as const,
      included: true,
    }));
}

export function autoMatchWorker(rowName: string, workers: WorkerOption[]): string {
  const norm = rowName.trim().toLowerCase();
  if (!norm) return "";
  
  // 1. Exact match
  const exact = workers.find((w) => w.name.trim().toLowerCase() === norm);
  if (exact) return exact.worker_id;

  // 2. Reverse name match (e.g., "כהן דני" -> "דני כהן")
  const parts = norm.split(/\s+/);
  if (parts.length >= 2) {
    const reversed = `${parts.slice(1).join(" ")} ${parts[0]}`;
    const revMatch = workers.find((w) => w.name.trim().toLowerCase() === reversed);
    if (revMatch) return revMatch.worker_id;
  }

  // 3. Partial substring match
  const partial = workers.find((w) => {
    const wNorm = w.name.trim().toLowerCase();
    if (!wNorm) return false;
    return wNorm.includes(norm) || norm.includes(wNorm);
  });
  if (partial) return partial.worker_id;

  return "";
}
