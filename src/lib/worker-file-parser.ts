import * as XLSX from "xlsx";

// Raw row from the xlsx before rank mapping
export interface RawWorker {
  worker_id: string;
  name: string;
  file_rank: string;     // rank as it appears in the file
  is_exempt: number;
  exemption_reason: string | null;
  receives_shift_allocation: number;
  release_date: string | null;
  notes: string | null;
  branch: string | null;
  team: string | null;
  phone: string | null;
}

// ── xlsx parser ───────────────────────────────────────────────

export function excelDateToIso(serial: unknown): string | null {
  if (serial == null || serial === "") return null;
  const n = Number(serial);
  if (isNaN(n) || n < 1) return null;
  // Excel serial: days since Dec 30 1899 (accounting for the 1900 leap-year bug)
  const ms = (n - 25569) * 86400 * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function normalizePhone(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  // xlsx with raw:true reads numeric cells as numbers, dropping the leading 0
  let s = String(raw).trim();
  if (!s) return null;
  // Strip common separators, keep digits and a leading +
  s = s.replace(/[\s\-().]/g, "");
  // Restore leading 0 for Israeli mobile numbers stored as numbers (e.g. 501234567)
  if (/^\d{9}$/.test(s) && s[0] === "5") s = "0" + s;
  return s;
}

export function parseWorkersXlsx(buffer: ArrayBuffer): { workers: RawWorker[]; errors: string[] } {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { workers: [], errors: ["לא נמצא גיליון בקובץ"] };

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true }) as unknown[][];
  // Skip header row
  const dataRows = rows[0]?.[0] === "מספר אישי" ? rows.slice(1) : rows;

  const workers: RawWorker[] = [];
  const errors: string[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i] as unknown[];
    const worker_id = r[0];
    const file_rank = r[1];
    const last_name = r[2];
    const first_name = r[3];
    const release_date_raw = r[5];
    const phone_raw = r[9];   // מספר טלפון נייד
    const notes = r[10];      // הערות
    const eligibility = r[11]; // כשירות

    if (worker_id == null || worker_id === "") continue;

    if (!file_rank || !last_name || !first_name) {
      errors.push(`שורה ${i + 2}: חסרים שדות חובה`);
      continue;
    }

    const eligStr = String(eligibility ?? "").trim();
    const is_exempt = eligStr === "לא כשיר" ? 1 : 0;
    const notesStr = notes ? String(notes).trim() : null;
    // For exempt workers הערות explains the exemption; for others it's a general note
    const exemption_reason = is_exempt ? notesStr : null;
    const worker_notes = is_exempt ? null : notesStr;

    workers.push({
      worker_id: String(worker_id),
      name: `${String(first_name).trim()} ${String(last_name).trim()}`,
      file_rank: String(file_rank).trim(),
      is_exempt,
      exemption_reason,
      receives_shift_allocation: 1,
      release_date: excelDateToIso(release_date_raw),
      notes: worker_notes,
      branch: null,
      team: null,
      phone: normalizePhone(phone_raw),
    });
  }

  return { workers, errors };
}

export function parseCsvWorkers(
  content: string,
  ranks: Set<string>
): { workers: RawWorker[]; errors: string[] } {
  const lines = content
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const workers: RawWorker[] = [];
  const errors: string[] = [];
  const startIndex =
    lines.length > 0 && (lines[0].startsWith("worker_id") || lines[0].startsWith("מספר"))
      ? 1
      : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const parts = lines[i].split(/[,\t]+/).map((p) => p.trim());
    const worker_id = parts[0];
    const name = parts[1];
    const file_rank = parts[2];

    if (!worker_id || !name || !file_rank) {
      errors.push(`שורה ${i + 1}: חסרים שדות חובה`);
      continue;
    }

    if (ranks.size > 0 && !ranks.has(file_rank)) {
      errors.push(`שורה ${i + 1}: דרגה "${file_rank}" לא קיימת — ניתן לשנות במיפוי`);
    }

    const is_exempt = parts[3] === "1" ? 1 : 0;
    const exemption_reason = is_exempt && parts[4] ? parts[4] : null;
    const receives_shift_allocation = parts[5] === "0" ? 0 : 1;

    workers.push({
      worker_id,
      name,
      file_rank,
      is_exempt,
      exemption_reason,
      receives_shift_allocation,
      release_date: null,
      notes: null,
      branch: null,
      team: null,
      phone: null,
    });
  }

  return { workers, errors };
}
