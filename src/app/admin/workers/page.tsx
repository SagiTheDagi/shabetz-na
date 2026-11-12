"use client";

import { LoadingState } from "@/components/loading-state";
import { Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Search, MessageCircle, AlertTriangle, Check, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PotentialExport } from "@/components/potential-export";
import { WorkerImport } from "@/components/worker-import";
import { useIsMobile } from "@/lib/use-media";
import {
  STATUS_OPTIONS,
  WorkerStatus,
  workerStatus,
  nextStatuses,
  applyFilters,
  activeFilterCount,
  toggleValue,
} from "@/lib/worker-filters";
import { useWorkerFilters, useFilterOptions } from "@/lib/use-worker-filters";
import { MobileWorkersList } from "@/components/mobile/workers-list";
import { InspectorPanel, InspectorWorkerData } from "@/components/inspector-panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Worker extends InspectorWorkerData {
  rank_id: string;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

interface Rank {
  rank_id: string;
  name: string;
}

export default function WorkersPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <WorkersPageContent />
    </Suspense>
  );
}

function WorkersPageContent() {
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const initialWorkerId = searchParams.get("worker");
  
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  
  // Filters (URL-synced, shared with mobile)
  const filterApi = useWorkerFilters();
  const { filters, update: updateFilters, reset: clearFilters } = filterApi;

  const { branchOptions, teamOptions } = useFilterOptions(workers, filters);

  function toggleStatus(s: WorkerStatus) {
    updateFilters({ statuses: nextStatuses(filters.statuses, s) });
  }

  const statusCounts = useMemo(() => {
    const c: Record<WorkerStatus, number> = { active: 0, exempt: 0, archived: 0 };
    for (const w of workers) c[workerStatus(w)]++;
    return c;
  }, [workers]);

  const filtersActive = !!filters.search || activeFilterCount(filters) > 0;

  async function reloadWorkers() {
    const res = await fetch("/api/workers?include_exempt=true&include_archived=true");
    setWorkers(await res.json());
  }

  useEffect(() => {
    async function loadData() {
      const [workersRes, ranksRes] = await Promise.all([
        fetch("/api/workers?include_exempt=true&include_archived=true"),
        fetch("/api/ranks"),
      ]);
      
      const workersData = await workersRes.json();
      const ranksData = await ranksRes.json();
      
      setWorkers(workersData);
      if (initialWorkerId) {
        const target = workersData.find((w: Worker) => w.worker_id === initialWorkerId);
        if (target) setSelectedWorker(target);
      }
      setRanks(ranksData);
      setLoading(false);
    }
    
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateUrlParam(key: string, value: string | null) {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
    window.history.replaceState(null, "", url);
  }

  function selectWorker(worker: Worker | null) {
    setSelectedWorker(worker);
    updateUrlParam("worker", worker?.worker_id ?? null);
  }

  const filteredWorkers = useMemo(() => applyFilters(workers, filters), [workers, filters]);

  const stats = useMemo(() => {
    const active = workers.filter((w) => w.is_archived !== 1);
    return {
      total: active.length,
      inWhatsapp: active.filter((w) => w.in_whatsapp_group === 1).length,
      exempt: active.filter((w) => w.is_exempt === 1).length,
    };
  }, [workers]);

  async function toggleWhatsapp(workerId: string, currentValue: number) {
    const newValue = currentValue === 1 ? 0 : 1;
    
    await fetch(`/api/workers/${workerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ in_whatsapp_group: newValue }),
    });
    
    setWorkers((prev) =>
      prev.map((w) =>
        w.worker_id === workerId ? { ...w, in_whatsapp_group: newValue } : w
      )
    );
    
    if (selectedWorker?.worker_id === workerId) {
      setSelectedWorker((prev) => prev ? { ...prev, in_whatsapp_group: newValue } : null);
    }
  }

  if (loading || isMobile === null) {
    return <LoadingState />;
  }

  if (isMobile) {
    return <MobileWorkersList workers={workers} ranks={ranks} filterApi={filterApi} />;
  }

  return (
    <div className="flex h-[calc(100vh-80px)]">
      {/* Main content */}
      <div className={`flex-1 flex flex-col ${selectedWorker ? "ml-80" : ""}`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div className="flex items-center gap-4">
            <h1 className="text-[18px] font-medium">עובדים</h1>
            <div className="flex items-center gap-3 text-[12px] nocturne-text-muted">
              <span>{stats.total} עובדים</span>
              <span className="w-1 h-1 rounded-full bg-white/20" />
              <span className="flex items-center gap-1">
                <MessageCircle className="h-3.5 w-3.5" />
                {stats.inWhatsapp} בקבוצה
              </span>
              <span className="w-1 h-1 rounded-full bg-white/20" />
              <span className="flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                {stats.exempt} פטורים
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
              ייצוא פוטנציאלים
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              ייבוא עובדים
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-white/5">
          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 nocturne-text-muted" />
            <input
              type="text"
              placeholder="חיפוש לפי שם, מספר אישי או טלפון..."
              value={filters.search}
              onChange={(e) => updateFilters({ search: e.target.value })}
              className="w-full h-9 pr-10 pl-3 rounded-lg text-[13px] nocturne-surface border border-white/5 focus:border-white/10 focus:outline-none"
            />
          </div>

          {/* WhatsApp filter */}
          <DropdownMenu>
            <DropdownMenuTrigger className={triggerClass}>
              <MessageCircle className="h-4 w-4" />
              {filters.whatsapp === "all" ? "הכל" : filters.whatsapp === "in" ? "בקבוצה" : "לא בקבוצה"}
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuCheckboxItem
                checked={filters.whatsapp === "all"}
                onCheckedChange={() => updateFilters({ whatsapp: "all" })}
              >
                הכל
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={filters.whatsapp === "in"}
                onCheckedChange={() => updateFilters({ whatsapp: "in" })}
              >
                בקבוצת וואטסאפ
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={filters.whatsapp === "out"}
                onCheckedChange={() => updateFilters({ whatsapp: "out" })}
              >
                לא בקבוצה
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Rank filter */}
          <DropdownMenu>
            <DropdownMenuTrigger className={triggerClass}>
              דרגה {filters.ranks.length > 0 && `(${filters.ranks.length})`}
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {ranks.map((rank) => (
                <DropdownMenuCheckboxItem
                  key={rank.rank_id}
                  checked={filters.ranks.includes(rank.rank_id)}
                  onCheckedChange={() =>
                    updateFilters({ ranks: toggleValue(filters.ranks, rank.rank_id) })
                  }
                >
                  {rank.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Branch filter */}
          <MultiFilter
            label="ענף"
            options={branchOptions}
            selected={filters.branches}
            onChange={(branches) => updateFilters({ branches })}
          />

          {/* Team filter */}
          {teamOptions.length > 0 && (
            <MultiFilter
              label="צוות"
              options={teamOptions}
              selected={filters.teams}
              onChange={(teams) => updateFilters({ teams })}
            />
          )}

          {/* Status filter (combinable) */}
          <div className="flex items-center rounded-lg border border-white/10 overflow-hidden text-[12px]">
            <button
              type="button"
              onClick={() => updateFilters({ statuses: STATUS_OPTIONS.map((o) => o.value) })}
              className={`px-3 py-1.5 transition-colors ${
                filters.statuses.length === STATUS_OPTIONS.length
                  ? "bg-[#9184d9]/20 nocturne-accent-light"
                  : "nocturne-text-muted hover:bg-white/5"
              }`}
            >
              הכל
            </button>
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => toggleStatus(o.value)}
                className={`px-3 py-1.5 border-r border-white/10 transition-colors ${
                  filters.statuses.includes(o.value)
                    ? "bg-[#9184d9]/20 nocturne-accent-light"
                    : "nocturne-text-muted hover:bg-white/5"
                }`}
              >
                {o.label} <span className="opacity-60">{statusCounts[o.value]}</span>
              </button>
            ))}
          </div>

          <div className="mr-auto flex items-center gap-3 text-[12px] nocturne-text-muted">
            <span>
              {filteredWorkers.length} מתוך {workers.length}
            </span>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="underline hover:text-white">
                נקה סינון
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 nocturne-bg">
              <tr className="text-[11px] nocturne-text-muted border-b border-white/5">
                <th className="text-right font-medium py-3 px-4">שם</th>
                <th className="text-right font-medium py-3 px-4">מספר אישי</th>
                <th className="text-right font-medium py-3 px-4">דרגה</th>
                <th className="text-right font-medium py-3 px-4">ענף</th>
                <th className="text-right font-medium py-3 px-4">טלפון</th>
                <th className="text-center font-medium py-3 px-4">וואטסאפ</th>
                <th className="text-center font-medium py-3 px-4">סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {filteredWorkers.map((worker) => (
                <tr
                  key={worker.worker_id}
                  onClick={() => selectWorker(worker)}
                  className={`text-[13px] border-b border-white/5 cursor-pointer transition-colors hover:bg-white/[0.02] ${
                    selectedWorker?.worker_id === worker.worker_id ? "bg-white/[0.04]" : ""
                  }`}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <span className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-medium nocturne-accent-muted nocturne-accent-light">
                        {worker.name.charAt(0)}
                      </span>
                      <span className="font-medium">{worker.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-[12px] nocturne-text-muted">
                    {worker.worker_id}
                  </td>
                  <td className="py-3 px-4">{worker.rank_name}</td>
                  <td className="py-3 px-4">
                    {worker.branch || <span className="nocturne-text-muted">—</span>}
                    {worker.team && (
                      <span className="nocturne-text-muted text-[12px]"> · {worker.team}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 nocturne-text-muted" dir="ltr">
                    {worker.phone || "—"}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex justify-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWhatsapp(worker.worker_id, worker.in_whatsapp_group ?? 0);
                        }}
                        className={`w-7 h-7 rounded-full grid place-items-center transition-colors ${
                          worker.in_whatsapp_group === 1
                            ? "bg-green-500/10 text-green-400 hover:bg-green-500/20"
                            : "bg-white/5 nocturne-text-muted hover:bg-white/10"
                        }`}
                      >
                        {worker.in_whatsapp_group === 1 ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex justify-center gap-1.5">
                      {worker.is_exempt === 1 && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400 border border-red-500/20">
                          פטור
                        </span>
                      )}
                      {worker.is_archived === 1 && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-gray-500/10 text-gray-400 border border-gray-500/20">
                          ארכיון
                        </span>
                      )}
                      {worker.is_exempt !== 1 && worker.is_archived !== 1 && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-green-500/10 text-green-400 border border-green-500/20">
                          פעיל
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredWorkers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 nocturne-text-muted">
              <span className="text-[14px]">לא נמצאו עובדים</span>
              <span className="text-[12px] mt-1">נסה לשנות את הפילטרים</span>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) reloadWorkers();
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>ייבוא עובדים מקובץ</DialogTitle>
          </DialogHeader>
          <WorkerImport />
        </DialogContent>
      </Dialog>

      <PotentialExport open={exportOpen} onClose={() => setExportOpen(false)} />

      {/* Inspector Panel */}
      {selectedWorker && (
        <div className="fixed top-0 left-0 w-80 h-full z-10">
          <InspectorPanel
            type="worker"
            worker={selectedWorker}
            onClose={() => selectWorker(null)}
            editable={true}
            onWorkerUpdate={(updatedWorker) => {
              // Update the worker in the list
              setWorkers((prev) =>
                prev.map((w) =>
                  w.worker_id === updatedWorker.worker_id
                    ? { ...w, ...updatedWorker }
                    : w
                )
              );
              // Update the selected worker
              setSelectedWorker((prev) =>
                prev ? { ...prev, ...updatedWorker } : null
              );
            }}
          />
        </div>
      )}
    </div>
  );
}

const triggerClass =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3";

function MultiFilter({
  label,
  options: items,
  selected,
  onChange,
}: {
  label: string;
  options: [string, string][];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClass} disabled={items.length === 0}>
        {label} {selected.length > 0 && `(${selected.length})`}
        <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        {items.map(([value, text]) => (
          <DropdownMenuCheckboxItem
            key={value}
            checked={selected.includes(value)}
            onCheckedChange={(checked) =>
              onChange(checked ? [...selected, value] : selected.filter((v) => v !== value))
            }
          >
            {text}
          </DropdownMenuCheckboxItem>
        ))}
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange([])}>נקה</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
