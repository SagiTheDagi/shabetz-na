"use client";

import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface WorkerOption {
  worker_id: string;
  name: string;
  notes: string | null;
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
}

function parseFormBuffer(buffer: ArrayBuffer, isCsv: boolean): FormRow[] {
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
        className="w-full h-8 px-2 text-xs text-right border border-input rounded-md bg-background flex items-center justify-between gap-1 hover:bg-accent"
      >
        <span className={selected ? "" : "text-muted-foreground"}>
          {selected ? `${selected.name} (${selected.worker_id})` : "בחר עובד..."}
        </span>
        <svg className="h-3 w-3 shrink-0 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[180px] rounded-md border border-border bg-popover shadow-md">
          <div className="p-1 border-b border-border">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש..."
              className="w-full text-xs px-2 py-1 rounded bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="text-xs text-muted-foreground px-3 py-1.5">לא נמצאו תוצאות</li>
            )}
            {filtered.map((w) => (
              <li
                key={w.worker_id}
                onMouseDown={(e) => { e.preventDefault(); onChange(w.worker_id); setOpen(false); }}
                className={`text-xs px-3 py-1.5 cursor-pointer hover:bg-accent flex justify-between gap-2 ${value === w.worker_id ? "bg-accent/60" : ""}`}
              >
                <span>{w.name}</span>
                <span className="text-muted-foreground">{w.worker_id}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function FormResponseImport() {
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [rows, setRows] = useState<FormRow[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    fetch("/api/workers?include_exempt=true")
      .then((r) => r.json())
      .then(setWorkers);
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const isCsv = file.name.endsWith(".csv");
    const parsed = parseFormBuffer(buffer, isCsv);

    if (parsed.length === 0) {
      toast.error("לא נמצאו שורות בקובץ");
      e.target.value = "";
      return;
    }

    setRows(parsed);
    toast.success(`נמצאו ${parsed.length} תגובות`);
    e.target.value = "";
  }

  function updateRow(id: number, patch: Partial<FormRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function toggleAll(included: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, included })));
  }

  async function handleImport() {
    const toImport = rows.filter((r) => r.included && r.workerId);
    if (toImport.length === 0) {
      toast.error("אין שורות מסומנות עם עובד משויך");
      return;
    }

    setImporting(true);
    let success = 0;
    let errors = 0;

    for (const row of toImport) {
      const worker = workers.find((w) => w.worker_id === row.workerId);
      let newNotes = row.constraints;

      if (row.mode === "append" && worker?.notes) {
        newNotes = worker.notes + "\n---\n" + row.constraints;
      }

      const res = await fetch(`/api/workers/${row.workerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: newNotes }),
      });

      if (res.ok) {
        success++;
        setWorkers((prev) =>
          prev.map((w) =>
            w.worker_id === row.workerId ? { ...w, notes: newNotes } : w
          )
        );
      } else {
        errors++;
      }
    }

    toast.success(
      `עודכנו ${success} עובדים${errors > 0 ? ` — ${errors} שגיאות` : ""}`
    );
    setImporting(false);
  }

  const includedWithWorker = rows.filter((r) => r.included && r.workerId).length;
  const includedWithout = rows.filter((r) => r.included && !r.workerId).length;

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground space-y-1">
        <p>קובץ CSV או XLSX מטופס Google Forms — עמודות: Timestamp, שם פרטי + משפחה, ענף, אילוצים</p>
        <p>לכל שורה יש לשייך עובד במערכת ולבחור האם להוסיף לסוף ההערות הקיימות או להחליפן.</p>
      </div>

      <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFile}
          className="block mx-auto text-sm"
        />
      </div>

      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex gap-2 text-sm">
              <span className="text-muted-foreground">{rows.length} שורות</span>
              {includedWithWorker > 0 && (
                <Badge variant="secondary">{includedWithWorker} מוכנות לייבוא</Badge>
              )}
              {includedWithout > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-300">
                  {includedWithout} ממתינות לשיוך
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => toggleAll(true)}>סמן הכל</Button>
              <Button variant="ghost" size="sm" onClick={() => toggleAll(false)}>בטל הכל</Button>
            </div>
          </div>

          <div className="overflow-auto max-h-[60vh] border rounded-lg">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-8">✓</TableHead>
                  <TableHead>שם + ענף</TableHead>
                  <TableHead className="min-w-64">אילוצים</TableHead>
                  <TableHead className="w-52">עובד במערכת</TableHead>
                  <TableHead className="w-28">מצב</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={!row.included ? "opacity-40" : ""}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={row.included}
                        onChange={(e) => updateRow(row.id, { included: e.target.checked })}
                        className="cursor-pointer"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{row.name}</div>
                      <div className="text-xs text-muted-foreground">{row.branch}</div>
                      <div className="text-xs text-muted-foreground">{row.timestamp.split(" ")[0]}</div>
                    </TableCell>
                    <TableCell>
                      <p className="text-xs whitespace-pre-line line-clamp-4 text-muted-foreground">
                        {row.constraints || <span className="italic">ריק</span>}
                      </p>
                    </TableCell>
                    <TableCell>
                      <WorkerCombobox
                        workers={workers}
                        value={row.workerId}
                        onChange={(v) => updateRow(row.id, { workerId: v })}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={row.mode}
                        onValueChange={(v) => updateRow(row.id, { mode: (v ?? "replace") as "append" | "replace" })}
                      >
                        <SelectTrigger className="w-full text-xs h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="replace">החלף</SelectItem>
                          <SelectItem value="append">הוסף לסוף</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Button
            onClick={handleImport}
            disabled={importing || includedWithWorker === 0}
            className="w-full"
          >
            {importing ? "מייבא..." : `ייבא ${includedWithWorker} שורות`}
          </Button>
        </>
      )}
    </div>
  );
}
