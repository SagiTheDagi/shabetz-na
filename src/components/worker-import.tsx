"use client";

import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import type { Rank } from "@/lib/types";

interface ParsedWorker {
  worker_id: string;
  name: string;
  rank_id: string;       // system rank_id (after mapping)
  is_exempt: number;
  exemption_reason: string | null;
  receives_shift_allocation: number;
  release_date: string | null;
  notes: string | null;
  branch: string | null;
  team: string | null;
  phone: string | null;
}

// Raw row from the xlsx before rank mapping
interface RawWorker {
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

function excelDateToIso(serial: unknown): string | null {
  if (serial == null || serial === "") return null;
  const n = Number(serial);
  if (isNaN(n) || n < 1) return null;
  // Excel serial: days since Dec 30 1899 (accounting for the 1900 leap-year bug)
  const ms = (n - 25569) * 86400 * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normalizePhone(raw: unknown): string | null {
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

function parseWorkersXlsx(buffer: ArrayBuffer): { workers: RawWorker[]; errors: string[] } {
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

function parseCsvWorkers(
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

// ── component ─────────────────────────────────────────────────

export function WorkerImport() {
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [rawWorkers, setRawWorkers] = useState<RawWorker[]>([]);
  const [rankMappings, setRankMappings] = useState<Record<string, string>>({}); // file_rank → rank_id
  const [parsed, setParsed] = useState<ParsedWorker[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    fetch("/api/ranks")
      .then((r) => r.json())
      .then(setRanks);
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset
    setRawWorkers([]);
    setRankMappings({});
    setParsed([]);
    setErrors([]);

    let result: { workers: RawWorker[]; errors: string[] };

    if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
      result = parseWorkersXlsx(await file.arrayBuffer());
    } else {
      const rankSet = new Set(ranks.map((r) => r.rank_id));
      result = parseCsvWorkers(await file.text(), rankSet);
    }

    if (result.workers.length === 0) {
      toast.error("לא נמצאו עובדים בקובץ");
      setErrors(result.errors);
      return;
    }

    // Build unique file ranks
    const fileRanks = [...new Set(result.workers.map((w) => w.file_rank))];
    // Auto-map if exact match exists in system ranks
    const rankIdSet = new Set(ranks.map((r) => r.rank_id));
    const defaultMappings: Record<string, string> = {};
    for (const fr of fileRanks) {
      defaultMappings[fr] = rankIdSet.has(fr) ? fr : (ranks[0]?.rank_id ?? "");
    }

    setRawWorkers(result.workers);
    setRankMappings(defaultMappings);
    setErrors(result.errors);
    toast.success(`נמצאו ${result.workers.length} עובדים, ${fileRanks.length} דרגות לשיוך`);
    e.target.value = "";
  }

  function confirmMappings() {
    const workers: ParsedWorker[] = rawWorkers.map((w) => ({
      ...w,
      rank_id: rankMappings[w.file_rank] ?? "",
    }));
    setParsed(workers);
    setRawWorkers([]);
    toast.success(`${workers.length} עובדים מוכנים לייבוא`);
  }

  async function handleImport() {
    if (parsed.length === 0) return;
    setImporting(true);

    const res = await fetch("/api/workers/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workers: parsed }),
    });

    const data = await res.json();
    if (res.ok) {
      // Also run release-date auto-archive now that release_dates are fresh
      const autoRes = await fetch("/api/workers/auto-archive", { method: "POST" });
      const autoData = autoRes.ok ? await autoRes.json() : { archived: 0 };

      const parts = [`יובאו ${data.created} חדשים, עודכנו ${data.updated}`];
      const totalArchived = (data.archived ?? 0) + (autoData.archived ?? 0);
      if (totalArchived > 0) parts.push(`הועברו לארכיון ${totalArchived}`);
      toast.success(parts.join(" — "));
      if (data.errors?.length > 0) toast.warning(`${data.errors.length} שגיאות: ${data.errors[0]}`);
      setParsed([]);
    } else {
      toast.error(data.error);
    }
    setImporting(false);
  }

  const rankNameMap = new Map(ranks.map((r) => [r.rank_id, r.name]));
  const uniqueFileRanks = [...new Set(rawWorkers.map((w) => w.file_rank))];
  const allMapped = uniqueFileRanks.length > 0 && uniqueFileRanks.every((fr) => rankMappings[fr]);

  return (
    <div className="space-y-4">
      {/* Instructions */}
      <div className="text-sm text-muted-foreground space-y-1">
        <p>קובץ XLSX (פורמט מחנה לוט&quot;ם) או CSV:</p>
        <code className="block bg-muted px-3 py-2 rounded text-xs font-mono">
          מספר_אישי, שם_פרטי, שם_משפחה, דרגה, כשירות, הערות
        </code>
        <p>
          דרגות במערכת:{" "}
          {ranks.map((r) => (
            <span key={r.rank_id} className="font-mono text-xs bg-muted px-1 rounded ml-1">
              {r.rank_id}
            </span>
          ))}
        </p>
      </div>

      {/* File input */}
      <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
        <input
          type="file"
          accept=".csv,.txt,.xlsx,.xls"
          onChange={handleFile}
          className="block mx-auto text-sm"
        />
      </div>

      {/* Parse errors */}
      {errors.length > 0 && (
        <div className="bg-destructive/10 text-destructive p-3 rounded text-sm space-y-1 max-h-32 overflow-auto">
          {errors.map((err, i) => <p key={i}>{err}</p>)}
        </div>
      )}

      {/* Rank mapping table */}
      {rawWorkers.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">שייך דרגות קובץ לדרגות המערכת:</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>דרגה בקובץ</TableHead>
                <TableHead>כמות עובדים</TableHead>
                <TableHead>דרגה במערכת</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {uniqueFileRanks.map((fr) => (
                <TableRow key={fr}>
                  <TableCell className="font-medium">{fr}</TableCell>
                  <TableCell>{rawWorkers.filter((w) => w.file_rank === fr).length}</TableCell>
                  <TableCell>
                    <Select
                      value={rankMappings[fr] ?? ""}
                      onValueChange={(v) => setRankMappings((prev) => ({ ...prev, [fr]: v as string }))}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="בחר דרגה" />
                      </SelectTrigger>
                      <SelectContent>
                        {ranks.map((r) => (
                          <SelectItem key={r.rank_id} value={r.rank_id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button onClick={confirmMappings} disabled={!allMapped} className="w-full">
            אישור מיפוי וטעינת עובדים
          </Button>
        </div>
      )}

      {/* Worker preview */}
      {parsed.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">
            {parsed.length} עובדים — עובדים קיימים יעודכנו,{" "}
            {parsed.filter((w) => w.is_exempt).length} פטורים
          </p>
          <div className="max-h-80 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>מס׳ אישי</TableHead>
                  <TableHead>שם</TableHead>
                  <TableHead>דרגה</TableHead>
                  <TableHead>פטור</TableHead>
                  <TableHead>סיבה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsed.map((w) => (
                  <TableRow key={w.worker_id}>
                    <TableCell className="font-mono">{w.worker_id}</TableCell>
                    <TableCell>{w.name}</TableCell>
                    <TableCell>{rankNameMap.get(w.rank_id) || w.rank_id}</TableCell>
                    <TableCell>{w.is_exempt ? "כן" : ""}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{w.exemption_reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Button onClick={handleImport} disabled={importing} className="w-full">
            {importing ? "מייבא..." : "אישור וייבוא"}
          </Button>
        </>
      )}
    </div>
  );
}
