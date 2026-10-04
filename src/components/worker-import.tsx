"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { handleImportInput, readImportFile } from "@/lib/file-import";
import type { Rank } from "@/lib/types";
import { parseWorkersXlsx, parseCsvWorkers, type RawWorker } from "@/lib/worker-file-parser";

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

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    return handleImportInput(e, async (file) => {
      // Reset
      setRawWorkers([]);
      setRankMappings({});
      setParsed([]);
      setErrors([]);

      const rankSet = new Set(ranks.map((r) => r.rank_id));
      const result = await readImportFile(file, {
        excel: parseWorkersXlsx,
        text: (content) => parseCsvWorkers(content, rankSet),
      });

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
    });
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
