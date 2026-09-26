"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/mobile/avatar";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { ToggleRow } from "@/components/mobile/toggle-row";

export interface MobileWorkerRow {
  worker_id: string;
  rank_id?: string;
  name: string;
  rank_name: string;
  branch: string | null;
  phone: string | null;
  in_whatsapp_group?: number;
  is_exempt: number;
  is_archived?: number;
}

export function MobileWorkersList({
  workers,
  ranks,
}: {
  workers: MobileWorkerRow[];
  ranks: { rank_id: string; name: string }[];
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");
  const [selectedRanks, setSelectedRanks] = useState<string[]>([]);
  const [showExempt, setShowExempt] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [sheet, setSheet] = useState(false);

  const active = useMemo(
    () => workers.filter((w) => showArchived || w.is_archived !== 1),
    [workers, showArchived]
  );
  const missing = active.filter((w) => w.in_whatsapp_group !== 1).length;
  const advancedCount = selectedRanks.length + (showExempt ? 0 : 1) + (showArchived ? 1 : 0);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return active.filter((w) => {
      if (filter === "out" && w.in_whatsapp_group === 1) return false;
      if (filter === "in" && w.in_whatsapp_group !== 1) return false;
      if (!showExempt && w.is_exempt === 1) return false;
      if (selectedRanks.length > 0 && !(w.rank_id && selectedRanks.includes(w.rank_id))) return false;
      if (!q) return true;
      return (
        w.name.toLowerCase().includes(q) ||
        w.worker_id.toLowerCase().includes(q) ||
        !!w.phone?.includes(q)
      );
    });
  }, [active, search, filter, showExempt, selectedRanks]);

  const chip = (on: boolean) =>
    `text-xs px-3 py-2 rounded-full ${
      on
        ? "shadow-[inset_0_0_0_1px_#9184d9] nocturne-accent-light"
        : "shadow-[inset_0_0_0_1px_#33364a] nocturne-text-muted"
    }`;

  return (
    <div className="flex flex-col gap-2.5 -mx-4 -mt-4 h-[calc(100%+1rem)]">
      <div className="px-4 pt-4 flex flex-col gap-2.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם / מספר אישי"
          className="min-h-11 rounded-lg px-3 text-sm nocturne-surface border border-white/5 focus:outline-none focus:border-white/15"
        />
        <div className="flex gap-1.5">
          <button className={chip(filter === "all")} onClick={() => setFilter("all")}>
            הכל · {active.length}
          </button>
          <button className={chip(filter === "out")} onClick={() => setFilter("out")}>
            לא בוואטסאפ · {missing}
          </button>
          <button className={`${chip(advancedCount > 0)} mr-auto`} onClick={() => setSheet(true)}>
            סינון{advancedCount > 0 ? ` · ${advancedCount}` : ""}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-4 flex flex-col">
        {rows.map((w) => {
          const inWa = w.in_whatsapp_group === 1;
          return (
            <Link
              key={w.worker_id}
              href={`/admin/workers/${encodeURIComponent(w.worker_id)}`}
              className="min-h-[62px] flex items-center gap-3 py-2 px-1 border-b border-white/5"
            >
              <Avatar name={w.name} size={38} />
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[15px] truncate">{w.name}</span>
                <span className="text-xs nocturne-text-muted truncate">
                  {w.rank_name}
                  {w.branch ? ` · ${w.branch}` : ""}
                </span>
              </span>
              <span className="mr-auto flex flex-none gap-1.5">
                {w.is_exempt === 1 && (
                  <span className="text-[11px] px-2 py-1 rounded-md bg-[#3f2b2f] nocturne-error">פטור</span>
                )}
                <span
                  className={`text-[11px] px-2 py-1 rounded-md ${
                    inWa ? "bg-[#1f2b28] nocturne-success" : "bg-[#3f2b2f] nocturne-error"
                  }`}
                >
                  {inWa ? "בקבוצה" : "לא בקבוצה"}
                </span>
              </span>
            </Link>
          );
        })}
        {rows.length === 0 && (
          <div className="py-16 text-center text-sm nocturne-text-muted">לא נמצאו עובדים</div>
        )}
      </div>
      <BottomSheet open={sheet} onClose={() => setSheet(false)} eyebrow="עובדים" title="סינון" closeLabel="סיום">
        <div className="px-[18px] flex flex-col gap-3.5 overflow-auto">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs nocturne-text-muted">וואטסאפ</span>
            <div className="flex gap-1.5">
              {(
                [
                  ["all", "הכל"],
                  ["in", "בקבוצה"],
                  ["out", "לא בקבוצה"],
                ] as const
              ).map(([v, l]) => (
                <button key={v} className={chip(filter === v)} onClick={() => setFilter(v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs nocturne-text-muted">דרגה</span>
            <div className="flex flex-wrap gap-1.5">
              {ranks.map((r) => (
                <button
                  key={r.rank_id}
                  className={chip(selectedRanks.includes(r.rank_id))}
                  onClick={() =>
                    setSelectedRanks((p) =>
                      p.includes(r.rank_id) ? p.filter((x) => x !== r.rank_id) : [...p, r.rank_id]
                    )
                  }
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl bg-[#232532] flex flex-col divide-y divide-white/5">
            <ToggleRow label="הצג פטורים" checked={showExempt} onChange={setShowExempt} />
            <ToggleRow label="הצג ארכיון" checked={showArchived} onChange={setShowArchived} />
          </div>
          {(advancedCount > 0 || filter !== "all") && (
            <button
              className="min-h-11 rounded-[10px] border nocturne-border text-sm"
              onClick={() => {
                setFilter("all");
                setSelectedRanks([]);
                setShowExempt(true);
                setShowArchived(false);
              }}
            >
              איפוס
            </button>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
