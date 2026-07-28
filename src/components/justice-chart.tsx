"use client";

import { useState, useEffect, useMemo } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import type { JusticeChartData } from "@/lib/types";

export function JusticeChart() {
  const [data, setData] = useState<JusticeChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const [filterName, setFilterName] = useState("");
  const [selectedRanks, setSelectedRanks] = useState<Set<string>>(new Set());
  const [minTotal, setMinTotal] = useState(0);

  useEffect(() => {
    loadChart();
  }, []);

  async function loadChart() {
    setLoading(true);
    try {
      const res = await fetch("/api/justice-chart");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdate() {
    setUpdating(true);
    try {
      const res = await fetch("/api/justice-chart", { method: "POST" });
      if (res.ok) {
        const next: JusticeChartData = await res.json();
        setData(next);
        setMinTotal(0);
        toast.success("טבלת הצדק עודכנה");
      } else {
        const body = await res.json();
        toast.error(body.error || "שגיאה בעדכון טבלת הצדק");
      }
    } finally {
      setUpdating(false);
    }
  }

  const entries = data?.entries ?? [];
  const shiftTypes = data?.shift_types ?? [];
  const firstEntry = entries[0];

  const uniqueRanks = useMemo(
    () => Array.from(new Set(entries.map((e) => e.rank_name))).sort((a, b) => a.localeCompare(b, "he")),
    [entries]
  );

  const maxPossibleTotal = useMemo(() => (entries.length > 0 ? Math.max(...entries.map((e) => e.total_shifts)) : 0), [entries]);

  const filteredEntries = useMemo(() => {
    const nameLower = filterName.trim().toLowerCase();
    return entries.filter((e) => {
      if (nameLower && !e.name.toLowerCase().includes(nameLower)) return false;
      if (selectedRanks.size > 0 && !selectedRanks.has(e.rank_name)) return false;
      if (e.total_shifts < minTotal) return false;
      return true;
    });
  }, [entries, filterName, selectedRanks, minTotal]);

  const maxShifts = filteredEntries.length > 0 ? Math.max(...filteredEntries.map((e) => e.total_shifts)) : 0;

  function totalBadgeVariant(count: number): "default" | "secondary" | "outline" {
    if (maxShifts === 0) return "outline";
    const ratio = count / maxShifts;
    if (ratio >= 0.8) return "default";
    if (ratio >= 0.5) return "secondary";
    return "outline";
  }

  function toggleRank(rank: string) {
    setSelectedRanks((prev) => {
      const next = new Set(prev);
      next.has(rank) ? next.delete(rank) : next.add(rank);
      return next;
    });
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("he-IL");
  }

  const hasFilters = filterName !== "" || selectedRanks.size > 0 || minTotal > 0;

  const rankLabel =
    selectedRanks.size === 0
      ? "כל הדרגות"
      : selectedRanks.size === 1
      ? Array.from(selectedRanks)[0]
      : `${selectedRanks.size} דרגות`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">טבלת צדק — משמרות בשנה האחרונה</h3>
          {firstEntry ? (
            <p className="text-xs text-muted-foreground">
              תקופה: {formatDate(firstEntry.period_start)} – {formatDate(firstEntry.period_end)} | עודכן:{" "}
              {formatDate(firstEntry.updated_at)}
            </p>
          ) : (
            !loading && (
              <p className="text-xs text-muted-foreground">טבלת הצדק לא חושבה עדיין. לחץ על "עדכן טבלת צדק".</p>
            )
          )}
        </div>
        <Button onClick={handleUpdate} disabled={updating}>
          {updating ? "מעדכן..." : "עדכן טבלת צדק"}
        </Button>
      </div>

      {!loading && entries.length > 0 && (
        <div className="flex gap-3 flex-wrap items-end">
          {/* Name search */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">שם</p>
            <Input
              placeholder="חיפוש..."
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              className="w-44"
            />
          </div>

          {/* Rank multi-select */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">דרגה</p>
            <Popover>
              <PopoverTrigger className={cn(buttonVariants({ variant: "outline" }), "w-44 justify-between font-normal")}>
                <span className="truncate">{rankLabel}</span>
                <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
              </PopoverTrigger>
              <PopoverContent className="w-48 p-2" align="start">
                <div className="space-y-1">
                  {uniqueRanks.map((rank) => (
                    <label
                      key={rank}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent"
                    >
                      <Checkbox
                        checked={selectedRanks.has(rank)}
                        onCheckedChange={() => toggleRank(rank)}
                      />
                      {rank}
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Min total slider */}
          <div className="space-y-1 min-w-52">
            <p className="text-xs text-muted-foreground">
              סה&quot;כ מינימום: <span className="font-medium text-foreground">{minTotal}</span>
            </p>
            <Slider
              min={0}
              max={maxPossibleTotal || 1}
              step={1}
              value={[minTotal]}
              onValueChange={(v) => setMinTotal(Array.isArray(v) ? v[0] : (v as number))}
              dir="ltr"
              className="w-52"
            />
          </div>

          {/* Clear + count */}
          <div className="flex items-center gap-2 pb-0.5">
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterName("");
                  setSelectedRanks(new Set());
                  setMinTotal(0);
                }}
              >
                נקה סינון
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {filteredEntries.length} / {entries.length} עובדים
            </span>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">טוען...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          אין נתונים. לחץ על "עדכן טבלת צדק" כדי לחשב.
        </p>
      ) : filteredEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">לא נמצאו עובדים התואמים את הסינון.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 text-center">#</TableHead>
                <TableHead>שם</TableHead>
                <TableHead>דרגה</TableHead>
                {shiftTypes.map((st) => (
                  <TableHead key={st.shift_type_id} className="text-center">
                    {st.name}
                  </TableHead>
                ))}
                <TableHead className="text-center">סופ&quot;ש</TableHead>
                <TableHead className="text-center font-semibold">סה&quot;כ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((entry, idx) => (
                <TableRow key={entry.worker_id}>
                  <TableCell className="text-center text-muted-foreground text-xs">{idx + 1}</TableCell>
                  <TableCell className="font-medium">{entry.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{entry.rank_name}</TableCell>
                  {shiftTypes.map((st) => (
                    <TableCell key={st.shift_type_id} className="text-center text-sm">
                      {entry.shift_counts[st.shift_type_id] ?? 0}
                    </TableCell>
                  ))}
                  <TableCell className="text-center text-sm">{entry.weekend_shifts}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={totalBadgeVariant(entry.total_shifts)}>{entry.total_shifts}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
