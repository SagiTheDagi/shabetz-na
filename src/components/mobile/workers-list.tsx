"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/mobile/avatar";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import {
  matchesMulti,
  filterOptions,
  nextStatuses,
  STATUS_OPTIONS,
  DEFAULT_STATUSES,
  WorkerStatus,
  workerStatus,
  sameStatuses,
} from "@/lib/worker-filters";

export interface MobileWorkerRow {
  worker_id: string;
  rank_id?: string;
  name: string;
  rank_name: string;
  branch: string | null;
  team?: string | null;
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
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<WorkerStatus[]>(DEFAULT_STATUSES);
  const [sheet, setSheet] = useState(false);

  const active = useMemo(
    () => workers.filter((w) => statuses.includes(workerStatus(w))),
    [workers, statuses]
  );
  const missing = active.filter((w) => w.in_whatsapp_group !== 1).length;
  const advancedCount =
    selectedRanks.length +
    selectedBranches.length +
    selectedTeams.length +
    (sameStatuses(statuses, DEFAULT_STATUSES) ? 0 : 1);
  const toggleStatus = (s: WorkerStatus) => setStatuses(nextStatuses(statuses, s));

  const branchOptions = useMemo(() => filterOptions(workers, (w) => w.branch, "ללא ענף"), [workers]);
  const teamOptions = useMemo(() => filterOptions(workers, (w) => w.team, "ללא צוות"), [workers]);
  const toggle = (set: (fn: (p: string[]) => string[]) => void, v: string) =>
    set((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return active.filter((w) => {
      if (filter === "out" && w.in_whatsapp_group === 1) return false;
      if (filter === "in" && w.in_whatsapp_group !== 1) return false;
      if (selectedRanks.length > 0 && !(w.rank_id && selectedRanks.includes(w.rank_id))) return false;
      if (!matchesMulti(selectedBranches, w.branch)) return false;
      if (!matchesMulti(selectedTeams, w.team)) return false;
      if (!q) return true;
      return (
        w.name.toLowerCase().includes(q) ||
        w.worker_id.toLowerCase().includes(q) ||
        !!w.phone?.includes(q)
      );
    });
  }, [active, search, filter, selectedRanks, selectedBranches, selectedTeams]);

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
          {branchOptions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs nocturne-text-muted">ענף</span>
              <div className="flex flex-wrap gap-1.5">
                {branchOptions.map(([v, l]) => (
                  <button key={v} className={chip(selectedBranches.includes(v))} onClick={() => toggle(setSelectedBranches, v)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
          {teamOptions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs nocturne-text-muted">צוות</span>
              <div className="flex flex-wrap gap-1.5">
                {teamOptions.map(([v, l]) => (
                  <button key={v} className={chip(selectedTeams.includes(v))} onClick={() => toggle(setSelectedTeams, v)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs nocturne-text-muted">סטטוס</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                className={chip(statuses.length === STATUS_OPTIONS.length)}
                onClick={() => setStatuses(STATUS_OPTIONS.map((o) => o.value))}
              >
                הכל
              </button>
              {STATUS_OPTIONS.map((o) => (
                <button key={o.value} className={chip(statuses.includes(o.value))} onClick={() => toggleStatus(o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {(advancedCount > 0 || filter !== "all") && (
            <button
              className="min-h-11 rounded-[10px] border nocturne-border text-sm"
              onClick={() => {
                setFilter("all");
                setSelectedRanks([]);
                setSelectedBranches([]);
                setSelectedTeams([]);
                setStatuses(DEFAULT_STATUSES);
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
