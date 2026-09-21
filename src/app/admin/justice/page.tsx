"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Search, ChevronDown, RefreshCw } from "lucide-react";
import type { JusticeChartData } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function JusticePage() {
  const [data, setData] = useState<JusticeChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const [filterName, setFilterName] = useState("");
  const [selectedRanks, setSelectedRanks] = useState<string[]>([]);
  const [minTotal, setMinTotal] = useState(0);

  async function loadChart() {
    setLoading(true);
    try {
      const res = await fetch("/api/justice-chart");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (selectedRanks.length > 0 && !selectedRanks.includes(e.rank_name)) return false;
      if (e.total_shifts < minTotal) return false;
      return true;
    });
  }, [entries, filterName, selectedRanks, minTotal]);

  const maxShifts = filteredEntries.length > 0 ? Math.max(...filteredEntries.map((e) => e.total_shifts)) : 0;

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("he-IL");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[13px] nocturne-text-muted">טוען...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-[1200px]">
      {/* Header with period info and update button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {firstEntry ? (
            <div className="flex items-center gap-3 text-[12px] nocturne-text-muted">
              <span>תקופה: {formatDate(firstEntry.period_start)} – {formatDate(firstEntry.period_end)}</span>
              <span className="w-1 h-1 rounded-full bg-white/20" />
              <span>עודכן: {formatDate(firstEntry.updated_at)}</span>
              <span className="w-1 h-1 rounded-full bg-white/20" />
              <span>{entries.length} עובדים</span>
            </div>
          ) : (
            <p className="text-[12px] nocturne-text-muted">טבלת הצדק לא חושבה עדיין</p>
          )}
        </div>
        <Button 
          onClick={handleUpdate} 
          disabled={updating}
          className="nocturne-accent-bg hover:opacity-90 text-[13px] h-9"
        >
          <RefreshCw className={`h-4 w-4 ml-2 ${updating ? "animate-spin" : ""}`} />
          {updating ? "מעדכן..." : "עדכן טבלת צדק"}
        </Button>
      </div>

      {entries.length > 0 && (
        <>
          {/* Filters */}
          <div className="flex items-center gap-3 p-3 rounded-lg nocturne-surface border border-white/5">
            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 nocturne-text-muted" />
              <input
                type="text"
                placeholder="חיפוש לפי שם..."
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
                className="w-full h-9 pr-10 pl-3 rounded-lg text-[13px] bg-white/[0.02] border border-white/5 focus:border-white/10 focus:outline-none"
              />
            </div>

            {/* Rank filter */}
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium border border-white/10 bg-white/[0.02] hover:bg-white/5 h-9 px-3">
                דרגה {selectedRanks.length > 0 && `(${selectedRanks.length})`}
                <ChevronDown className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {uniqueRanks.map((rank) => (
                  <DropdownMenuCheckboxItem
                    key={rank}
                    checked={selectedRanks.includes(rank)}
                    onCheckedChange={(checked) => {
                      setSelectedRanks((prev) =>
                        checked ? [...prev, rank] : prev.filter((r) => r !== rank)
                      );
                    }}
                  >
                    {rank}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Min total slider */}
            <div className="flex items-center gap-3">
              <span className="text-[12px] nocturne-text-muted">מינימום:</span>
              <input
                type="range"
                min={0}
                max={maxPossibleTotal || 1}
                value={minTotal}
                onChange={(e) => setMinTotal(parseInt(e.target.value))}
                className="w-32 accent-[#9184d9]"
              />
              <span className="text-[12px] font-medium w-6">{minTotal}</span>
            </div>

            {/* Clear filters */}
            {(filterName || selectedRanks.length > 0 || minTotal > 0) && (
              <button
                className="text-[12px] nocturne-text-muted hover:nocturne-accent-light"
                onClick={() => {
                  setFilterName("");
                  setSelectedRanks([]);
                  setMinTotal(0);
                }}
              >
                נקה פילטרים
              </button>
            )}

            <span className="text-[12px] nocturne-text-muted mr-auto">
              {filteredEntries.length}/{entries.length}
            </span>
          </div>

          {/* Table */}
          {filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 nocturne-text-muted">
              <span className="text-[14px]">לא נמצאו עובדים</span>
              <span className="text-[12px] mt-1">נסה לשנות את הפילטרים</span>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg nocturne-surface border border-white/5">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-center text-[11px] font-medium py-3 px-3 nocturne-text-muted w-10">#</th>
                    <th className="text-right text-[11px] font-medium py-3 px-4 nocturne-text-muted">שם</th>
                    <th className="text-right text-[11px] font-medium py-3 px-4 nocturne-text-muted">דרגה</th>
                    {shiftTypes.map((st) => (
                      <th key={st.shift_type_id} className="text-center text-[11px] font-medium py-3 px-3 nocturne-text-muted min-w-[70px]">
                        {st.name}
                      </th>
                    ))}
                    <th className="text-center text-[11px] font-medium py-3 px-3 nocturne-text-muted min-w-[70px]">סופ״ש</th>
                    <th className="text-center text-[11px] font-semibold py-3 px-3 nocturne-accent-light min-w-[70px]">סה״כ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry, idx) => {
                    const ratio = maxShifts > 0 ? entry.total_shifts / maxShifts : 0;
                    const barColor = ratio >= 0.8 ? "bg-green-500" : ratio >= 0.5 ? "bg-amber-500" : "bg-white/20";
                    
                    return (
                      <tr key={entry.worker_id} className="border-b border-white/5 last:border-b-0 hover:bg-white/[0.02]">
                        <td className="text-center py-3 px-3 text-[11px] nocturne-text-muted">{idx + 1}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-medium nocturne-accent-muted nocturne-accent-light">
                              {entry.name.charAt(0)}
                            </span>
                            <span className="text-[13px] font-medium">{entry.name}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-[12px] nocturne-text-muted">{entry.rank_name}</td>
                        {shiftTypes.map((st) => (
                          <td key={st.shift_type_id} className="text-center py-3 px-3 text-[13px]">
                            {entry.shift_counts[st.shift_type_id] ?? 0}
                          </td>
                        ))}
                        <td className="text-center py-3 px-3 text-[13px] text-purple-400">
                          {entry.weekend_shifts}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-12 h-1.5 rounded-full bg-white/10 overflow-hidden">
                              <div 
                                className={`h-full rounded-full ${barColor}`}
                                style={{ width: `${ratio * 100}%` }}
                              />
                            </div>
                            <span className="text-[13px] font-semibold w-6 text-center">{entry.total_shifts}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {entries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 nocturne-surface rounded-lg border border-white/5">
          <span className="text-[14px] nocturne-text-muted">אין נתונים</span>
          <span className="text-[12px] mt-1 nocturne-text-tertiary">לחץ על &quot;עדכן טבלת צדק&quot; כדי לחשב</span>
        </div>
      )}
    </div>
  );
}
