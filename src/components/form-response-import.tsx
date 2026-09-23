"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Calendar,
  FileText,
  Sparkles,
  Clock,
  X,
  RefreshCw,
  Info,
  Pencil,
  RotateCcw
} from "lucide-react";
import {
  parseConstraints,
  computeCoverage,
  type ParsedConstraints,
  type ConstraintChip,
  type ConstraintPolarity,
  type QuarterBounds
} from "@/lib/constraint-parser";
import { toShortDate, hebrewDayName, enumerateDates } from "@/lib/date-utils";
import type { Quarter } from "@/lib/types";

interface ChipOverride {
  start: string;
  end: string;
}

/** Dates for a chip, honouring a manual range override if the admin set one. */
function effectiveDates(
  chip: ConstraintChip,
  override: ChipOverride | undefined,
  quarterBounds: QuarterBounds | null
): string[] {
  if (!override) return chip.dates;
  if (!quarterBounds) return [];
  const start = override.start < quarterBounds.start_date ? quarterBounds.start_date : override.start;
  const end = override.end > quarterBounds.end_date ? quarterBounds.end_date : override.end;
  if (end < start) return [];
  return enumerateDates(start, end);
}

interface WorkerOption {
  worker_id: string;
  name: string;
  notes: string | null;
  standing_constraints: string | null;
}

interface FormRow {
  id: number;
  timestamp: string;
  name: string;
  branch: string;
  constraints: string;
  workerId: string;
  mode: "append" | "replace";
  included: boolean;
  // Custom user overrides per row
  blockPolarities: Record<number, ConstraintPolarity>;
  disabledChips: Record<string, boolean>; // key: "blockIdx:chipIdx"
  chipOverrides: Record<string, ChipOverride>; // key: "blockIdx:chipIdx"
  includeRecurring: boolean;
  includeLeftover: boolean;
  expanded: boolean;
}

function parseFormBuffer(buffer: ArrayBuffer, isCsv: boolean): Omit<FormRow, "blockPolarities" | "disabledChips" | "chipOverrides" | "includeRecurring" | "includeLeftover" | "expanded">[] {
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

function autoMatchWorker(rowName: string, workers: WorkerOption[]): string {
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
    return wNorm.includes(norm) || norm.includes(wNorm);
  });
  if (partial) return partial.worker_id;

  return "";
}

function WorkerCombobox({
  workers,
  value,
  onChange,
}: {
  workers: WorkerOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const selected = workers.find((w) => w.worker_id === value);
  const filtered = workers.filter(
    (w) =>
      w.name.includes(search) ||
      w.worker_id.includes(search)
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setSearch(""); }}
        className="w-full h-8 px-2.5 text-xs text-right border border-white/10 rounded-md bg-white/[0.02] flex items-center justify-between gap-1 hover:bg-white/[0.05] transition-colors"
      >
        <span className={selected ? "font-medium" : "nocturne-text-muted"}>
          {selected ? `${selected.name} (${selected.worker_id})` : "בחר עובד..."}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] rounded-md border border-white/10 nocturne-surface shadow-xl">
          <div className="p-1 border-b border-white/10">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם או מספר..."
              className="w-full text-xs px-2 py-1.5 rounded bg-white/[0.03] outline-none nocturne-text placeholder:nocturne-text-muted border border-transparent focus:border-white/10"
            />
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="text-xs nocturne-text-muted px-3 py-2 text-center">לא נמצאו תוצאות</li>
            )}
            {filtered.map((w) => (
              <li
                key={w.worker_id}
                onMouseDown={(e) => { e.preventDefault(); onChange(w.worker_id); setOpen(false); }}
                className={`text-xs px-3 py-1.5 cursor-pointer hover:bg-white/10 flex justify-between gap-2 ${value === w.worker_id ? "bg-white/10 font-medium nocturne-accent-light" : ""}`}
              >
                <span>{w.name}</span>
                <span className="font-mono text-[11px] nocturne-text-muted">{w.worker_id}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function FormResponseImport() {
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [selectedQuarter, setSelectedQuarter] = useState<string>("");
  const [shiftDates, setShiftDates] = useState<string[]>([]);
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [rows, setRows] = useState<FormRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  // Fetch initial data
  useEffect(() => {
    async function init() {
      try {
        const [qRes, wRes] = await Promise.all([
          fetch("/api/quarters"),
          fetch("/api/workers?include_exempt=true")
        ]);

        if (!qRes.ok || !wRes.ok) {
          toast.error("שגיאה בטעינת נתונים ראשוניים");
          return;
        }

        const qData: Quarter[] = await qRes.json();
        const wData: WorkerOption[] = await wRes.json();

        setQuarters(qData);
        setWorkers(wData);

        if (qData.length > 0) {
          setSelectedQuarter(qData[0].quarter_id);
        }
      } catch (error) {
        toast.error("שגיאת רשת בטעינת נתונים");
        console.error("Init error:", error);
      }
    }
    init();
  }, []);

  // Fetch shift dates when selected quarter changes
  useEffect(() => {
    if (!selectedQuarter) {
      setShiftDates([]);
      return;
    }
    fetch(`/api/shifts?quarter_id=${selectedQuarter}`)
      .then((r) => r.json())
      .then((data: { date: string }[]) => {
        setShiftDates(Array.from(new Set(data.map((s) => s.date))).sort());
      })
      .catch(() => setShiftDates([]));
  }, [selectedQuarter]);

  const activeQuarterObj = useMemo(
    () => quarters.find((q) => q.quarter_id === selectedQuarter),
    [quarters, selectedQuarter]
  );

  const quarterBounds: QuarterBounds | null = useMemo(() => {
    if (!activeQuarterObj) return null;
    return {
      start_date: activeQuarterObj.start_date,
      end_date: activeQuarterObj.end_date,
    };
  }, [activeQuarterObj]);


  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const isCsv = file.name.endsWith(".csv");
    const parsedRaw = parseFormBuffer(buffer, isCsv);

    if (parsedRaw.length === 0) {
      toast.error("לא נמצאו שורות בקובץ");
      e.target.value = "";
      return;
    }

    // Auto-match workers and set defaults
    const fullRows: FormRow[] = parsedRaw.map((r) => {
      const autoId = autoMatchWorker(r.name, workers);
      return {
        ...r,
        workerId: autoId,
        blockPolarities: {},
        disabledChips: {},
        chipOverrides: {},
        includeRecurring: true,
        includeLeftover: true,
        expanded: false,
      };
    });

    setRows(fullRows);
    const matchedCount = fullRows.filter((r) => r.workerId).length;
    toast.success(`נמצאו ${fullRows.length} תגובות (${matchedCount} שויכו אוטומטית)`);
    e.target.value = "";
  }

  function updateRow(id: number, patch: Partial<FormRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function toggleAll(included: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, included })));
  }

  // Parsed results computed for each row
  const parsedRowsData = useMemo(() => {
    if (!quarterBounds) return new Map<number, ParsedConstraints>();
    const map = new Map<number, ParsedConstraints>();
    for (const r of rows) {
      if (!r.constraints) continue;
      // Deliberately not restricted to existing shift dates: a worker's
      // stated unavailability should be recorded for every requested date in
      // the quarter, even ones without a shift yet (one may be added later).
      const res = parseConstraints(r.constraints, quarterBounds);
      map.set(r.id, res);
    }
    return map;
  }, [rows, quarterBounds]);

  // Overall summary statistics
  const summary = useMemo(() => {
    let totalParsedDates = 0;
    let totalFlags = 0;
    let totalWorkersWithDates = 0;

    for (const r of rows) {
      if (!r.included || !r.workerId) continue;
      const parsed = parsedRowsData.get(r.id);
      if (!parsed) continue;

      let workerDatesCount = 0;
      parsed.blocks.forEach((block, bIdx) => {
        block.chips.forEach((chip, cIdx) => {
          const key = `${bIdx}:${cIdx}`;
          if (r.disabledChips[key]) return;
          const override = r.chipOverrides[key];
          workerDatesCount += effectiveDates(chip, override, quarterBounds).length;
          if (!override) totalFlags += chip.flags.length;
        });
      });

      if (workerDatesCount > 0) {
        totalParsedDates += workerDatesCount;
        totalWorkersWithDates++;
      }
    }

    return {
      totalParsedDates,
      totalFlags,
      totalWorkersWithDates,
    };
  }, [rows, parsedRowsData, quarterBounds]);

  async function handleImport() {
    if (!selectedQuarter) {
      toast.error("יש לבחור רבעון לפני ייבוא");
      return;
    }

    const toImport = rows.filter((r) => r.included && r.workerId);
    if (toImport.length === 0) {
      toast.error("אין שורות מסומנות עם עובד משויך");
      return;
    }

    setImporting(true);
    let totalEntriesCount = 0;

    const bulkWorkersPayload: {
      worker_id: string;
      entries: { date: string; status: ConstraintPolarity; note: string | null }[];
    }[] = [];

    // Collect all worker PATCH requests for batching
    const workerPatchRequests: Promise<Response>[] = [];

    // Collect availability entries + prepare notes / standing constraints updates
    for (const row of toImport) {
      const parsed = parsedRowsData.get(row.id);
      const workerObj = workers.find((w) => w.worker_id === row.workerId);
      const entriesForWorker: { date: string; status: ConstraintPolarity; note: string | null }[] = [];

      if (parsed) {
        // Collect entries from active chips
        parsed.blocks.forEach((block, bIdx) => {
          const polarity = row.blockPolarities[bIdx] ?? block.polarity;
          block.chips.forEach((chip, cIdx) => {
            const key = `${bIdx}:${cIdx}`;
            if (row.disabledChips[key]) return;
            const dates = effectiveDates(chip, row.chipOverrides[key], quarterBounds);
            for (const d of dates) {
              entriesForWorker.push({
                date: d,
                status: polarity,
                note: chip.reason || null,
              });
            }
          });
        });
      }

      if (entriesForWorker.length > 0) {
        bulkWorkersPayload.push({
          worker_id: row.workerId,
          entries: entriesForWorker,
        });
        totalEntriesCount += entriesForWorker.length;
      }

      // Build combined patch payload for this worker
      const patchPayload: { standing_constraints?: string; notes?: string } = {};

      // Handle recurring weekdays (standing_constraints)
      if (parsed?.recurringText && row.includeRecurring) {
        let newStanding = parsed.recurringText;
        if (row.mode === "append" && workerObj?.standing_constraints) {
          newStanding = `${workerObj.standing_constraints}\n${parsed.recurringText}`;
        }
        patchPayload.standing_constraints = newStanding;
      }

      // Handle leftover text / raw notes
      const hasLeftovers = parsed && parsed.leftover.length > 0;
      if ((hasLeftovers && row.includeLeftover) || (!parsed && row.constraints)) {
        const textToSave = parsed && parsed.leftover.length > 0
          ? parsed.leftover.join("\n")
          : row.constraints;

        let newNotes = textToSave;
        if (row.mode === "append" && workerObj?.notes) {
          newNotes = `${workerObj.notes}\n---\n${textToSave}`;
        }
        patchPayload.notes = newNotes;
      }

      // Only add PATCH request if we have something to update
      if (Object.keys(patchPayload).length > 0) {
        workerPatchRequests.push(
          fetch(`/api/workers/${row.workerId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patchPayload),
          })
        );
      }
    }

    try {
      // Execute all worker PATCH requests in parallel
      if (workerPatchRequests.length > 0) {
        const patchResults = await Promise.all(workerPatchRequests);
        const failedPatches = patchResults.filter((r) => !r.ok);
        if (failedPatches.length > 0) {
          toast.error(`${failedPatches.length} עדכוני עובדים נכשלו`);
        }
      }

      // Call bulk availability write endpoint if we have parsed dates
      if (bulkWorkersPayload.length > 0) {
        const res = await fetch("/api/availability/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quarter_id: selectedQuarter,
            source: "form_import",
            workers: bulkWorkersPayload,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          toast.error(err.error || "שגיאה בייבוא האילוצים");
          setImporting(false);
          return;
        }
      }

      toast.success(
        `עודכנו ${toImport.length} עובדים (${totalEntriesCount} תאריכי אילוצים יובאו ברבעון ${selectedQuarter})`
      );
      setRows([]);
    } catch (error) {
      toast.error("שגיאת רשת בעת ייבוא האילוצים");
      console.error("Import error:", error);
    } finally {
      setImporting(false);
    }
  }

  const includedWithWorker = rows.filter((r) => r.included && r.workerId).length;
  const includedWithout = rows.filter((r) => r.included && !r.workerId).length;

  return (
    <div className="space-y-4">
      {/* Quarter Selection Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-lg nocturne-surface border border-white/5">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 nocturne-accent-light" />
          <div className="flex flex-col">
            <span className="text-[14px] font-medium">ייבוא אילוצים מטופס Google Forms</span>
            <span className="text-[12px] nocturne-text-muted">
              פענוח אוטומטי של תאריכים, אילוצים קבועים והערות לתוך לוח הזמינות
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[12px] nocturne-text-muted">רבעון יעד:</span>
          <Select value={selectedQuarter} onValueChange={(v) => setSelectedQuarter(v ?? "")}>
            <SelectTrigger className="w-36 h-8 text-xs bg-white/[0.02] border-white/10">
              <SelectValue placeholder="בחר רבעון" />
            </SelectTrigger>
            <SelectContent>
              {quarters.map((q) => (
                <SelectItem key={q.quarter_id} value={q.quarter_id}>
                  {q.quarter_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* File Upload Box */}
      <div className="border-2 border-dashed border-white/10 rounded-lg p-6 text-center nocturne-surface hover:border-white/20 transition-colors">
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFile}
          className="block mx-auto text-xs nocturne-text-muted file:mr-4 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:nocturne-accent-bg file:hover:opacity-90 cursor-pointer"
        />
        <p className="text-[11px] nocturne-text-tertiary mt-2">
          עמודות מצופות: Timestamp, שם פרטי + משפחה, ענף, אילוצים
        </p>
      </div>

      {/* Summary Bar & Table */}
      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5">
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <span className="font-medium">{rows.length} תגובות</span>
              <span className="w-1 h-1 rounded-full bg-white/20" />
              {includedWithWorker > 0 && (
                <Badge variant="secondary" className="bg-green-500/10 text-green-400 border-green-500/20">
                  {includedWithWorker} משויכות
                </Badge>
              )}
              {includedWithout > 0 && (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20">
                  {includedWithout} ללא שיוך
                </Badge>
              )}
              {summary.totalParsedDates > 0 && (
                <>
                  <span className="w-1 h-1 rounded-full bg-white/20" />
                  <span className="flex items-center gap-1 nocturne-accent-light font-medium">
                    <Sparkles className="h-3.5 w-3.5" />
                    {summary.totalParsedDates} תאריכי אילוץ פעונחו
                  </span>
                </>
              )}
              {summary.totalFlags > 0 && (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {summary.totalFlags} התראות לפענוח
                </Badge>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggleAll(true)}>סמן הכל</Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggleAll(false)}>בטל הכל</Button>
            </div>
          </div>

          {/* Response Rows Table */}
          <div className="space-y-3">
            {rows.map((row) => {
              const parsed = parsedRowsData.get(row.id);

              return (
                <div
                  key={row.id}
                  className={`rounded-lg border transition-all nocturne-surface ${
                    !row.included 
                      ? "opacity-40 border-white/5" 
                      : row.workerId 
                      ? "border-white/10" 
                      : "border-amber-500/30 bg-amber-500/[0.02]"
                  }`}
                >
                  {/* Row Header */}
                  <div className="p-3 flex items-start gap-3">
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={row.included}
                      onChange={(e) => updateRow(row.id, { included: e.target.checked })}
                      className="mt-1 rounded cursor-pointer accent-primary"
                    />

                    {/* Respondent Info */}
                    <div className="w-44 flex-none">
                      <div className="font-medium text-[13px]">{row.name}</div>
                      {row.branch && <div className="text-[11px] nocturne-text-muted">{row.branch}</div>}
                      <div className="text-[10px] nocturne-text-tertiary font-mono">{row.timestamp.split(" ")[0]}</div>
                    </div>

                    {/* System Worker Picker */}
                    <div className="w-52 flex-none">
                      <WorkerCombobox
                        workers={workers}
                        value={row.workerId}
                        onChange={(v) => updateRow(row.id, { workerId: v })}
                      />
                    </div>

                    {/* Mode Selector */}
                    <div className="w-28 flex-none">
                      <Select
                        value={row.mode}
                        onValueChange={(v) => updateRow(row.id, { mode: (v ?? "replace") as "append" | "replace" })}
                      >
                        <SelectTrigger className="w-full text-xs h-8 bg-white/[0.02] border-white/10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="replace">החלף הערות</SelectItem>
                          <SelectItem value="append">הוסף להערות</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Expand/Collapse details */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs mr-auto nocturne-text-muted hover:nocturne-text"
                      onClick={() => updateRow(row.id, { expanded: !row.expanded })}
                    >
                      {row.expanded ? "הסתר פרטים" : "הצג פרטים"}
                      {row.expanded ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
                    </Button>
                  </div>

                  {/* Raw Text & Structured Parsed Preview */}
                  <div className="px-3 pb-3 pt-0 mr-7 border-t border-white/5 mt-1 space-y-2">
                    {/* Constraints prose preview */}
                    <div className="text-[12px] nocturne-text-muted p-2 rounded bg-white/[0.02] border border-white/5">
                      <span className="text-[10px] uppercase font-medium nocturne-text-tertiary block mb-0.5">טקסט מקורי:</span>
                      <p className={`whitespace-pre-line ${!row.expanded ? "line-clamp-2" : ""}`}>
                        {row.constraints || <span className="italic nocturne-text-tertiary">ללא אילוצים</span>}
                      </p>
                    </div>

                    {/* Parsed Output Blocks & Chips */}
                    {parsed && (parsed.blocks.length > 0 || parsed.recurringWeekdays.length > 0 || parsed.leftover.length > 0) && (
                      <div className="p-3 rounded-lg bg-white/[0.03] border border-white/10 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium uppercase tracking-wide nocturne-accent-light flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5" />
                            אילוצים שפעונחו ({parsed.allDates.length} תאריכים)
                          </span>

                          {shiftDates.length > 0 && (
                            <span className="text-[11px] nocturne-text-muted">
                              כיסוי חסום: {computeCoverage(parsed, shiftDates).pct}% ברבעון
                            </span>
                          )}
                        </div>

                        {/* Parsed Blocks */}
                        {parsed.blocks.map((block, bIdx) => {
                          const blockPolarity = row.blockPolarities[bIdx] ?? block.polarity;

                          return (
                            <div key={bIdx} className="p-2.5 rounded bg-black/20 border border-white/5 space-y-2">
                              {/* Block Header & Polarity Selector */}
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                {block.headerText && (
                                  <span className="text-[12px] font-medium nocturne-text">
                                    {block.headerText}
                                  </span>
                                )}

                                <div className="flex items-center gap-1.5 mr-auto">
                                  <span className="text-[11px] nocturne-text-muted">סטטוס גורף:</span>
                                  <Select
                                    value={blockPolarity}
                                    onValueChange={(val) => {
                                      const nextMap = { ...row.blockPolarities, [bIdx]: val as ConstraintPolarity };
                                      updateRow(row.id, { blockPolarities: nextMap });
                                    }}
                                  >
                                    <SelectTrigger className="h-6 text-[11px] px-2 w-28 bg-white/[0.03] border-white/10">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="unavailable">לא יכול (אדום)</SelectItem>
                                      <SelectItem value="prefer_not_work">מעדיף לא (כתום)</SelectItem>
                                      <SelectItem value="prefer_work">מעדיף (ירוק)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              {/* Chips in Block */}
                              <div className="flex flex-wrap gap-2 pt-1">
                                {block.chips.map((chip, cIdx) => {
                                  const key = `${bIdx}:${cIdx}`;
                                  const disabled = !!row.disabledChips[key];
                                  const override = row.chipOverrides[key];
                                  const dates = effectiveDates(chip, override, quarterBounds);
                                  const editKey = `${row.id}:${key}`;
                                  const isEditing = editingKey === editKey;

                                  return (
                                    <div
                                      key={cIdx}
                                      className={`inline-flex flex-col gap-1 p-2 rounded-md border text-[11px] transition-colors ${
                                        disabled
                                          ? "opacity-30 border-white/10 bg-white/[0.01]"
                                          : blockPolarity === "unavailable"
                                          ? "bg-red-500/10 border-red-500/20 text-red-300"
                                          : blockPolarity === "prefer_not_work"
                                          ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
                                          : "bg-green-500/10 border-green-500/20 text-green-300"
                                      }`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            updateRow(row.id, {
                                              disabledChips: { ...row.disabledChips, [key]: !disabled },
                                            });
                                          }}
                                          className="p-0.5 rounded hover:bg-white/10"
                                          title={disabled ? "הפעל תאריך זה" : "התעלם מתאריך זה"}
                                        >
                                          {disabled ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                                        </button>

                                        <span className="font-medium font-mono">
                                          {dates.length > 0 ? (
                                            dates.length > 1
                                              ? `${toShortDate(dates[0])} - ${toShortDate(dates.at(-1)!)} (${dates.length} ימים)`
                                              : `${toShortDate(dates[0])} (${hebrewDayName(dates[0])})`
                                          ) : (
                                            <>
                                              {chip.matchedText}
                                              <span className="nocturne-text-muted font-normal"> · אין משמרות בטווח</span>
                                            </>
                                          )}
                                        </span>

                                        {chip.reason && (
                                          <span className="nocturne-text-muted truncate max-w-[150px]">
                                            • {chip.reason}
                                          </span>
                                        )}

                                        <button
                                          type="button"
                                          onClick={() => setEditingKey(isEditing ? null : editKey)}
                                          className="p-0.5 rounded hover:bg-white/10 mr-auto"
                                          title="ערוך טווח תאריכים"
                                        >
                                          <Pencil className="h-3 w-3" />
                                        </button>
                                      </div>

                                      {/* Manual range editor */}
                                      {isEditing && (
                                        <div className="flex items-center gap-1 pt-1 border-t border-white/10">
                                          <input
                                            type="date"
                                            value={override?.start ?? chip.rawStart}
                                            onChange={(e) =>
                                              updateRow(row.id, {
                                                chipOverrides: {
                                                  ...row.chipOverrides,
                                                  [key]: { start: e.target.value, end: override?.end ?? chip.rawEnd },
                                                },
                                              })
                                            }
                                            className="text-[10px] bg-white/[0.03] border border-white/10 rounded px-1 py-0.5 w-[112px]"
                                          />
                                          <span>-</span>
                                          <input
                                            type="date"
                                            value={override?.end ?? chip.rawEnd}
                                            onChange={(e) =>
                                              updateRow(row.id, {
                                                chipOverrides: {
                                                  ...row.chipOverrides,
                                                  [key]: { start: override?.start ?? chip.rawStart, end: e.target.value },
                                                },
                                              })
                                            }
                                            className="text-[10px] bg-white/[0.03] border border-white/10 rounded px-1 py-0.5 w-[112px]"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const next = { ...row.chipOverrides };
                                              delete next[key];
                                              updateRow(row.id, { chipOverrides: next });
                                              setEditingKey(null);
                                            }}
                                            className="p-0.5 rounded hover:bg-white/10 nocturne-text-muted"
                                            title="אפס לפענוח האוטומטי"
                                          >
                                            <RotateCcw className="h-3 w-3" />
                                          </button>
                                        </div>
                                      )}

                                      {/* Manual-override badge, replaces the auto flags once reviewed */}
                                      {override && !disabled && (
                                        <div className="flex items-center gap-1 pt-0.5 border-t border-white/10 text-[10px] text-blue-400">
                                          <Pencil className="h-2.5 w-2.5 shrink-0" />
                                          טווח נערך ידנית — אין צורך באישור
                                        </div>
                                      )}

                                      {/* Flags / Warnings on Chip */}
                                      {chip.flags.length > 0 && !disabled && !override && (
                                        <div className="flex flex-col gap-0.5 pt-0.5 border-t border-white/10">
                                          {chip.flags.map((flag, fIdx) => (
                                            <span
                                              key={fIdx}
                                              className={`text-[10px] flex items-center gap-1 ${
                                                flag.severity === "error"
                                                  ? "text-red-400 font-medium"
                                                  : flag.severity === "warning"
                                                  ? "text-amber-400"
                                                  : "text-blue-400"
                                              }`}
                                            >
                                              <Info className="h-2.5 w-2.5 shrink-0" />
                                              {flag.message}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}

                        {/* Recurring Weekdays Option */}
                        {parsed.recurringWeekdays.length > 0 && (
                          <div className="p-2 rounded bg-purple-500/10 border border-purple-500/20 text-[11px] flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Clock className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                              <span>אילוצים קבועים זוהו: <strong className="text-purple-300">{parsed.recurringText}</strong></span>
                            </div>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={row.includeRecurring}
                                onChange={(e) => updateRow(row.id, { includeRecurring: e.target.checked })}
                                className="accent-primary"
                              />
                              <span>שמור באילוצים קבועים</span>
                            </label>
                          </div>
                        )}

                        {/* Leftover Text Option */}
                        {parsed.leftover.length > 0 && (
                          <div className="p-2 rounded bg-white/[0.02] border border-white/5 text-[11px] flex items-center justify-between">
                            <div className="flex items-center gap-2 nocturne-text-muted">
                              <FileText className="h-3.5 w-3.5 shrink-0" />
                              <span>טקסט שלא פוענח להערות: <span className="italic">{parsed.leftover.join("; ")}</span></span>
                            </div>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={row.includeLeftover}
                                onChange={(e) => updateRow(row.id, { includeLeftover: e.target.checked })}
                                className="accent-primary"
                              />
                              <span>שמור בהערות עובד</span>
                            </label>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Import Action Button */}
          <Button
            onClick={handleImport}
            disabled={importing || includedWithWorker === 0}
            className="w-full nocturne-accent-bg hover:opacity-90 h-10 text-sm font-medium"
          >
            {importing ? (
              <span className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" />
                מייבא אילוצים ללוח הזמינות...
              </span>
            ) : (
              `אישור וייבוא אילוצים עבור ${includedWithWorker} עובדים (${summary.totalParsedDates} תאריכי משמרות)`
            )}
          </Button>
        </>
      )}
    </div>
  );
}
