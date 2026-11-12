"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/mobile/avatar";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import {
  nextStatuses,
  STATUS_OPTIONS,
  WorkerStatus,
  workerStatus,
  applyFilters,
  activeFilterCount,
  toggleValue,
} from "@/lib/worker-filters";
import { useFilterOptions, type WorkersUrlStateApi } from "@/lib/use-workers-url-state";

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
  filterApi,
}: {
  workers: MobileWorkerRow[];
  ranks: { rank_id: string; name: string }[];
  filterApi: WorkersUrlStateApi;
}) {
  const { filters, update, reset } = filterApi;
  const [sheet, setSheet] = useState(false);

  // Count in the "הכל" chip reflects the status selection only
  const active = useMemo(
    () => workers.filter((w) => filters.statuses.includes(workerStatus(w))),
    [workers, filters.statuses]
  );
  const missing = active.filter((w) => w.in_whatsapp_group !== 1).length;
  // "לא בוואטסאפ" has its own header chip; "בקבוצה" doesn't, so it counts toward the "סינון" badge
  const advancedCount = activeFilterCount(filters) - (filters.whatsapp === "out" ? 1 : 0);
  const toggleStatus = (s: WorkerStatus) => update({ statuses: nextStatuses(filters.statuses, s) });

  const { branchOptions, teamOptions } = useFilterOptions(workers, filters);

  const rows = useMemo(() => applyFilters(workers, filters), [workers, filters]);

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
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          placeholder="חיפוש לפי שם / מספר אישי"
          className="min-h-11 rounded-lg px-3 text-sm nocturne-surface border border-white/5 focus:outline-none focus:border-white/15"
        />
        <div className="flex gap-1.5">
          <button className={chip(filters.whatsapp === "all")} onClick={() => update({ whatsapp: "all" })}>
            הכל · {active.length}
          </button>
          <button className={chip(filters.whatsapp === "out")} onClick={() => update({ whatsapp: "out" })}>
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
              // A selection kept from desktop would act as a deep link on Back; drop it first
              onClick={() => filterApi.selectedId && filterApi.clearSelectionNow()}
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
                <button key={v} className={chip(filters.whatsapp === v)} onClick={() => update({ whatsapp: v })}>
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
                  className={chip(filters.ranks.includes(r.rank_id))}
                  onClick={() => update({ ranks: toggleValue(filters.ranks, r.rank_id) })}
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
                  <button key={v} className={chip(filters.branches.includes(v))}
                    onClick={() => update({ branches: toggleValue(filters.branches, v) })}>
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
                  <button key={v} className={chip(filters.teams.includes(v))}
                    onClick={() => update({ teams: toggleValue(filters.teams, v) })}>
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
                className={chip(filters.statuses.length === STATUS_OPTIONS.length)}
                onClick={() => update({ statuses: STATUS_OPTIONS.map((o) => o.value) })}
              >
                הכל
              </button>
              {STATUS_OPTIONS.map((o) => (
                <button key={o.value} className={chip(filters.statuses.includes(o.value))} onClick={() => toggleStatus(o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {(advancedCount > 0 || filters.whatsapp !== "all") && (
            <button
              className="min-h-11 rounded-[10px] border nocturne-border text-sm"
              onClick={reset}
            >
              איפוס
            </button>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
