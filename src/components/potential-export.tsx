"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { PotentialWorker, Quarter } from "@/lib/types";

const ALL_BRANCHES = "__all__";
const NO_BRANCH = "__none__";

type SortKey = "name" | "worker_id" | "branch" | "shifts" | "weekends" | "is_exempt";
type SortDir = "asc" | "desc";

interface PotentialExportProps {
  open: boolean;
  onClose: () => void;
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {label}
        {active &&
          (dir === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          ))}
      </button>
    </TableHead>
  );
}

export function PotentialExport({ open, onClose }: PotentialExportProps) {
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [selectedQuarter, setSelectedQuarter] = useState("");
  const [workers, setWorkers] = useState<PotentialWorker[]>([]);
  const [loading, setLoading] = useState(false);
  const [branch, setBranch] = useState(ALL_BRANCHES);
  // Default sort: fewest shifts first, so workers with no shifts float to the top.
  const [sortKey, setSortKey] = useState<SortKey>("shifts");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    if (!open) return;
    async function loadQuarters() {
      const data: Quarter[] = await (await fetch("/api/quarters")).json();
      setQuarters(data);
      if (data.length > 0) setSelectedQuarter((prev) => prev || data[0].quarter_id);
    }
    loadQuarters();
  }, [open]);

  useEffect(() => {
    if (!open || !selectedQuarter) return;
    async function loadWorkers() {
      setLoading(true);
      try {
        const data: PotentialWorker[] = await (
          await fetch(`/api/workers/potential?quarter_id=${selectedQuarter}`)
        ).json();
        setWorkers(data);
      } finally {
        setLoading(false);
      }
    }
    loadWorkers();
  }, [open, selectedQuarter]);

  const branches = useMemo(
    () =>
      Array.from(new Set(workers.map((w) => w.branch).filter((b): b is string => !!b))).sort(
        (a, b) => a.localeCompare(b, "he")
      ),
    [workers]
  );
  // Some workers (e.g. exempt / releasing this quarter) have no branch assigned;
  // give them their own bucket so a branch filter never hides them entirely.
  const hasNoBranch = useMemo(() => workers.some((w) => !w.branch), [workers]);

  const rows = useMemo(() => {
    const filtered =
      branch === ALL_BRANCHES
        ? workers
        : branch === NO_BRANCH
        ? workers.filter((w) => !w.branch)
        : workers.filter((w) => w.branch === branch);

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name, "he");
          break;
        case "worker_id":
          cmp = a.worker_id.localeCompare(b.worker_id, "he");
          break;
        case "branch":
          cmp = (a.branch ?? "").localeCompare(b.branch ?? "", "he");
          break;
        case "shifts":
          cmp = a.shifts - b.shifts;
          break;
        case "weekends":
          cmp = a.weekends - b.weekends;
          break;
        case "is_exempt":
          cmp = a.is_exempt - b.is_exempt;
          break;
      }
      // Stable tie-breaker so equal rows keep a predictable order.
      if (cmp === 0) cmp = a.name.localeCompare(b.name, "he");
      return cmp * dir;
    });
  }, [workers, branch, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Numeric columns are most useful low→high; text columns a→z.
      setSortDir("asc");
    }
  }

  function handleExport() {
    if (rows.length === 0) {
      toast.error("אין עובדים לייצוא");
      return;
    }
    const branchLabel =
      branch === ALL_BRANCHES ? "כל הענפים" : branch === NO_BRANCH ? "ללא ענף" : branch;
    const aoa = [
      ['שם', 'מספר עובד', 'ענף', 'משמרות', 'סופ"ש', "פטור?", "סיבת פטור"],
      ...rows.map((w) => [
        w.name,
        w.worker_id,
        w.branch ?? "",
        w.shifts,
        w.weekends,
        w.is_exempt ? "כן" : "לא",
        w.exemption_reason ?? "",
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Display the sheet right-to-left so Hebrew columns read naturally.
    ws["!views"] = [{ RTL: true }];
    ws["!cols"] = [
      { wch: 22 },
      { wch: 12 },
      { wch: 16 },
      { wch: 10 },
      { wch: 8 },
      { wch: 8 },
      { wch: 30 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "פוטנציאלים");
    const safeBranch = branchLabel.replace(/[\\/:*?"<>|]/g, "-");
    XLSX.writeFile(wb, `shabetz-potential-${selectedQuarter}-${safeBranch}.xlsx`);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-3" dir="rtl">
        <DialogHeader>
          <DialogTitle>ייצוא פוטנציאלים</DialogTitle>
        </DialogHeader>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">רבעון</p>
            <Select value={selectedQuarter} onValueChange={(v) => v && setSelectedQuarter(v)}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="רבעון" />
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

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">ענף</p>
            <Select value={branch} onValueChange={(v) => v && setBranch(v)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="ענף" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_BRANCHES}>כל הענפים</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
                {hasNoBranch && <SelectItem value={NO_BRANCH}>ללא ענף</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          <span className="text-xs text-muted-foreground pb-2">{rows.length} עובדים</span>
        </div>

        <div className="flex-1 overflow-auto border rounded">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">טוען...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">אין עובדים להצגה.</p>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  {(
                    [
                      { label: "שם", key: "name" as const },
                      { label: "מספר עובד", key: "worker_id" as const },
                      { label: "ענף", key: "branch" as const },
                      { label: "משמרות", key: "shifts" as const, center: true },
                      { label: 'סופ"ש', key: "weekends" as const, center: true },
                      { label: "פטור?", key: "is_exempt" as const, center: true },
                    ]
                  ).map((col) => (
                    <SortHeader
                      key={col.key}
                      label={col.label}
                      sortKey={col.key}
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={toggleSort}
                      className={col.center ? "text-center" : undefined}
                    />
                  ))}
                  <TableHead>סיבת פטור</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((w) => (
                  <TableRow key={w.worker_id}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{w.worker_id}</TableCell>
                    <TableCell className="text-sm">{w.branch ?? "—"}</TableCell>
                    <TableCell className="text-center">{w.shifts}</TableCell>
                    <TableCell className="text-center">{w.weekends}</TableCell>
                    <TableCell className="text-center">
                      {w.is_exempt ? (
                        <Badge variant="destructive" className="text-xs">
                          פטור
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {w.exemption_reason ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            סגור
          </Button>
          <Button onClick={handleExport} disabled={loading || rows.length === 0}>
            הורד Excel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
