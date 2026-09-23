"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Search, MessageCircle, AlertTriangle, Check, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PotentialExport } from "@/components/potential-export";
import { WorkerImport } from "@/components/worker-import";
import { InspectorPanel, InspectorWorkerData } from "@/components/inspector-panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
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
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="text-[13px] nocturne-text-muted">טוען...</div></div>}>
      <WorkersPageContent />
    </Suspense>
  );
}

function WorkersPageContent() {
  const searchParams = useSearchParams();
  const initialFilter = searchParams.get("filter");
  const initialSearch = searchParams.get("search") ?? "";
  const initialWorkerId = searchParams.get("worker");
  
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  
  // Filters
  const [showExempt, setShowExempt] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [whatsappFilter, setWhatsappFilter] = useState<"all" | "in" | "out">(
    initialFilter === "no-whatsapp" ? "out" : "all"
  );
  const [selectedRanks, setSelectedRanks] = useState<string[]>([]);

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

  function handleSearchChange(value: string) {
    setSearch(value);
    updateUrlParam("search", value || null);
  }

  function selectWorker(worker: Worker | null) {
    setSelectedWorker(worker);
    updateUrlParam("worker", worker?.worker_id ?? null);
  }

  const filteredWorkers = useMemo(() => {
    return workers.filter((w) => {
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        if (
          !w.name.toLowerCase().includes(searchLower) &&
          !w.worker_id.toLowerCase().includes(searchLower) &&
          !(w.phone?.includes(search))
        ) {
          return false;
        }
      }
      
      // Exempt filter
      if (!showExempt && w.is_exempt === 1) return false;
      
      // Archived filter
      if (!showArchived && w.is_archived === 1) return false;
      
      // WhatsApp filter
      if (whatsappFilter === "in" && w.in_whatsapp_group !== 1) return false;
      if (whatsappFilter === "out" && w.in_whatsapp_group === 1) return false;
      
      // Rank filter
      if (selectedRanks.length > 0 && !selectedRanks.includes(w.rank_id)) return false;
      
      return true;
    });
  }, [workers, search, showExempt, showArchived, whatsappFilter, selectedRanks]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[13px] nocturne-text-muted">טוען...</div>
      </div>
    );
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
        <div className="flex items-center gap-3 p-4 border-b border-white/5">
          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 nocturne-text-muted" />
            <input
              type="text"
              placeholder="חיפוש לפי שם, מספר אישי או טלפון..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full h-9 pr-10 pl-3 rounded-lg text-[13px] nocturne-surface border border-white/5 focus:border-white/10 focus:outline-none"
            />
          </div>

          {/* WhatsApp filter */}
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3">
              <MessageCircle className="h-4 w-4" />
              {whatsappFilter === "all" ? "הכל" : whatsappFilter === "in" ? "בקבוצה" : "לא בקבוצה"}
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuCheckboxItem
                checked={whatsappFilter === "all"}
                onCheckedChange={() => setWhatsappFilter("all")}
              >
                הכל
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={whatsappFilter === "in"}
                onCheckedChange={() => setWhatsappFilter("in")}
              >
                בקבוצת וואטסאפ
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={whatsappFilter === "out"}
                onCheckedChange={() => setWhatsappFilter("out")}
              >
                לא בקבוצה
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Rank filter */}
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3">
              דרגה {selectedRanks.length > 0 && `(${selectedRanks.length})`}
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {ranks.map((rank) => (
                <DropdownMenuCheckboxItem
                  key={rank.rank_id}
                  checked={selectedRanks.includes(rank.rank_id)}
                  onCheckedChange={(checked) => {
                    setSelectedRanks((prev) =>
                      checked
                        ? [...prev, rank.rank_id]
                        : prev.filter((r) => r !== rank.rank_id)
                    );
                  }}
                >
                  {rank.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Other filters */}
          <button
            type="button"
            onClick={() => setShowExempt(!showExempt)}
            className={`flex items-center gap-2 text-[12px] px-3 py-1.5 rounded-lg border transition-colors ${
              showExempt 
                ? "bg-white/5 border-white/20" 
                : "bg-transparent border-white/10 nocturne-text-muted"
            }`}
          >
            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] ${
              showExempt ? "bg-[#9184d9] border-[#9184d9] text-white" : "border-white/30"
            }`}>
              {showExempt && "✓"}
            </span>
            הצג פטורים
          </button>

          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className={`flex items-center gap-2 text-[12px] px-3 py-1.5 rounded-lg border transition-colors ${
              showArchived 
                ? "bg-white/5 border-white/20" 
                : "bg-transparent border-white/10 nocturne-text-muted"
            }`}
          >
            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] ${
              showArchived ? "bg-[#9184d9] border-[#9184d9] text-white" : "border-white/30"
            }`}>
              {showArchived && "✓"}
            </span>
            הצג ארכיון
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 nocturne-bg">
              <tr className="text-[11px] nocturne-text-muted border-b border-white/5">
                <th className="text-right font-medium py-3 px-4">שם</th>
                <th className="text-right font-medium py-3 px-4">מספר אישי</th>
                <th className="text-right font-medium py-3 px-4">דרגה</th>
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
