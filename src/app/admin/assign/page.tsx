"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ForceAssignModal } from "@/components/force-assign-modal";
import type { Quarter, AssignmentWarning } from "@/lib/types";

interface ShiftDateRow {
  shift_date_id: string;
  date: string;
  shift_type_id: string;
  shift_type_name: string;
  is_weekend: number;
  quarter_id: string;
}

interface AssignmentRow {
  assignment_id: string;
  shift_date_id: string;
  worker_id: string;
  worker_name: string;
  is_forced: number;
}

interface WorkerSuggestion {
  worker_id: string;
  name: string;
  rank_id: string;
  rank_name: string;
  is_exempt: number;
  warnings: AssignmentWarning[];
  days_since_last_shift: number | null;
  assigned_this_quarter: boolean;
  availability_status: string | null;
  is_eligible: boolean;
}

const HEBREW_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

function getDayName(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return HEBREW_DAYS[d.getDay()];
}

// --- Draggable Worker Card ---
function DraggableWorkerCard({ worker }: { worker: WorkerSuggestion }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `worker-${worker.worker_id}`,
    data: worker,
  });

  const maxSeverity = worker.warnings.reduce(
    (max, w) => {
      const order = { red: 3, amber: 2, orange: 1, green: 0 };
      return order[w.severity] > order[max] ? w.severity : max;
    },
    "green" as AssignmentWarning["severity"]
  );

  const borderColor =
    maxSeverity === "red"
      ? "border-r-red-500"
      : maxSeverity === "amber"
        ? "border-r-amber-500"
        : maxSeverity === "orange"
          ? "border-r-orange-500"
          : "border-r-green-500";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`p-3 bg-card border rounded-lg cursor-grab active:cursor-grabbing border-r-4 ${borderColor} ${
        isDragging ? "opacity-50" : ""
      } hover:shadow-sm transition-shadow`}
    >
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-sm">{worker.name}</span>
          <Badge variant="secondary" className="mr-2 text-xs">
            {worker.rank_name}
          </Badge>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 mt-1">
        {worker.availability_status === "prefer_work" && (
          <span className="text-xs text-green-600">🟢 מעדיף</span>
        )}
        {worker.availability_status === "prefer_not_work" && (
          <span className="text-xs text-orange-600">🟠 מעדיף לא</span>
        )}
        {worker.availability_status === "unavailable" && (
          <span className="text-xs text-red-600">🔴 לא יכול</span>
        )}
        {worker.assigned_this_quarter && (
          <span className="text-xs text-amber-600">✓ שובץ כבר</span>
        )}
        {worker.days_since_last_shift !== null && (
          <span className="text-xs text-muted-foreground">
            {worker.days_since_last_shift} ימים
          </span>
        )}
        {!worker.is_eligible && (
          <span className="text-xs text-red-600">⛔ לא כשיר</span>
        )}
        {worker.is_exempt === 1 && (
          <span className="text-xs text-red-600">⛔ פטור</span>
        )}
      </div>
    </div>
  );
}

// --- Droppable Shift Card ---
function DroppableShiftCard({
  shift,
  assignment,
  isSelected,
  onSelect,
  onUnassign,
}: {
  shift: ShiftDateRow;
  assignment: AssignmentRow | null;
  isSelected: boolean;
  onSelect: () => void;
  onUnassign: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `shift-${shift.shift_date_id}`,
    data: shift,
  });

  return (
    <div
      ref={setNodeRef}
      onClick={onSelect}
      className={`p-3 border rounded-lg cursor-pointer transition-all ${
        isSelected ? "ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-950" : "bg-card hover:bg-muted/50"
      } ${isOver ? "ring-2 ring-green-400 bg-green-50 dark:bg-green-950" : ""}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">
            {formatDate(shift.date)} {getDayName(shift.date)}
          </span>
          <Badge variant="outline" className="text-xs">
            {shift.shift_type_name}
          </Badge>
          {shift.is_weekend === 1 && (
            <Badge className="text-xs bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-800">
              סופ&quot;ש
            </Badge>
          )}
        </div>
      </div>
      {assignment ? (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm text-green-700 flex items-center gap-1">
            ✅ {assignment.worker_name}
            {assignment.is_forced === 1 && (
              <Badge variant="destructive" className="text-xs">כפוי</Badge>
            )}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-red-500 h-6"
            onClick={(e) => {
              e.stopPropagation();
              onUnassign();
            }}
          >
            הסר
          </Button>
        </div>
      ) : (
        <div className="mt-2 text-sm text-muted-foreground">לא משובץ</div>
      )}
    </div>
  );
}

// --- Main Page ---
export default function AssignPage() {
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [selectedQuarter, setSelectedQuarter] = useState<string>("");
  const [shiftDates, setShiftDates] = useState<ShiftDateRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [workers, setWorkers] = useState<WorkerSuggestion[]>([]);
  const [activeWorker, setActiveWorker] = useState<WorkerSuggestion | null>(null);

  // Force assign modal state
  const [forceModal, setForceModal] = useState<{
    open: boolean;
    shiftDateId: string;
    workerId: string;
    workerName: string;
    warnings: AssignmentWarning[];
  }>({ open: false, shiftDateId: "", workerId: "", workerName: "", warnings: [] });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const loadQuarters = useCallback(async () => {
    const res = await fetch("/api/quarters");
    const data: Quarter[] = await res.json();
    setQuarters(data);
    if (data.length > 0) setSelectedQuarter(data[0].quarter_id);
  }, []);

  useEffect(() => {
    loadQuarters();
  }, [loadQuarters]);

  const loadShiftsAndAssignments = useCallback(async () => {
    if (!selectedQuarter) return;
    const [shiftsRes, assignRes] = await Promise.all([
      fetch(`/api/shifts?quarter_id=${selectedQuarter}`),
      fetch(`/api/assignments?quarter_id=${selectedQuarter}`),
    ]);
    setShiftDates(await shiftsRes.json());
    setAssignments(await assignRes.json());
  }, [selectedQuarter]);

  useEffect(() => {
    loadShiftsAndAssignments();
  }, [loadShiftsAndAssignments]);

  const loadWorkers = useCallback(async () => {
    if (!selectedShiftId) {
      setWorkers([]);
      return;
    }
    const res = await fetch(
      `/api/assignments/warnings?shift_date_id=${selectedShiftId}`
    );
    setWorkers(await res.json());
  }, [selectedShiftId]);

  useEffect(() => {
    loadWorkers();
  }, [loadWorkers]);

  function getAssignment(shiftDateId: string): AssignmentRow | null {
    return assignments.find((a) => a.shift_date_id === shiftDateId) || null;
  }

  async function handleAssign(
    shiftDateId: string,
    workerId: string,
    isForced = false,
    forceReason?: string
  ) {
    const res = await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shift_date_id: shiftDateId,
        worker_id: workerId,
        is_forced: isForced,
        force_reason: forceReason,
      }),
    });

    const data = await res.json();

    if (res.status === 422 && data.requiresForce) {
      const worker = workers.find((w) => w.worker_id === workerId);
      setForceModal({
        open: true,
        shiftDateId,
        workerId,
        workerName: worker?.name || workerId,
        warnings: data.warnings,
      });
      return;
    }

    if (!res.ok) {
      toast.error(data.error);
      return;
    }

    toast.success("עובד שובץ");
    loadShiftsAndAssignments();
    loadWorkers();
  }

  async function handleUnassign(shiftDateId: string) {
    const res = await fetch(
      `/api/assignments?shift_date_id=${shiftDateId}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      toast.success("שיבוץ הוסר");
      loadShiftsAndAssignments();
      loadWorkers();
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveWorker(event.active.data.current as WorkerSuggestion);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveWorker(null);
    const { active, over } = event;
    if (!over) return;

    const workerId = (active.id as string).replace("worker-", "");
    const shiftDateId = (over.id as string).replace("shift-", "");

    handleAssign(shiftDateId, workerId);
  }

  async function handleExport() {
    if (!selectedQuarter) return;
    const res = await fetch(`/api/export?quarter_id=${selectedQuarter}`);
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shabetz-${selectedQuarter}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("קובץ יוצא");
  }

  async function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        const res = await fetch("/api/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (res.ok) {
          toast.success("קובץ יובא בהצלחה");
          loadShiftsAndAssignments();
        } else {
          const err = await res.json();
          toast.error(err.error);
        }
      } catch {
        toast.error("קובץ JSON לא תקין");
      }
    };
    input.click();
  }

  const assignedCount = assignments.length;
  const totalCount = shiftDates.length;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center gap-3">
            <Select
              value={selectedQuarter}
              onValueChange={(v) => v && setSelectedQuarter(v)}
            >
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
            <span className="text-sm text-muted-foreground">
              {assignedCount}/{totalCount} שובצו
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}>
              ייצוא JSON
            </Button>
            <Button variant="outline" size="sm" onClick={handleImport}>
              ייבוא JSON
            </Button>
          </div>
        </div>

        {/* Split panel */}
        <div className="flex gap-4 flex-1 min-h-0">
          {/* Left: Shift dates */}
          <div className="flex-3 overflow-auto space-y-2 pe-2">
            <h3 className="text-sm font-semibold text-muted-foreground sticky top-0 bg-background py-1">
              📋 תאריכי משמרות
            </h3>
            {shiftDates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                אין תאריכי משמרות. העלה קובץ תאריכים קודם.
              </p>
            ) : (
              shiftDates.map((sd) => (
                <DroppableShiftCard
                  key={sd.shift_date_id}
                  shift={sd}
                  assignment={getAssignment(sd.shift_date_id)}
                  isSelected={selectedShiftId === sd.shift_date_id}
                  onSelect={() => setSelectedShiftId(sd.shift_date_id)}
                  onUnassign={() => handleUnassign(sd.shift_date_id)}
                />
              ))
            )}
          </div>

          {/* Right: Workers */}
          <div className="flex-2 overflow-auto space-y-2 ps-2 border-s">
            <h3 className="text-sm font-semibold text-muted-foreground sticky top-0 bg-background py-1">
              👥 עובדים{" "}
              {selectedShiftId && (
                <span className="font-normal text-muted-foreground">
                  ({workers.length})
                </span>
              )}
            </h3>
            {!selectedShiftId ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                בחר תאריך משמרת כדי לראות עובדים
              </p>
            ) : workers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                אין עובדים
              </p>
            ) : (
              workers.map((w) => (
                <DraggableWorkerCard key={w.worker_id} worker={w} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeWorker && (
          <div className="p-3 bg-card border rounded-lg shadow-lg opacity-80 border-r-4 border-r-blue-500">
            <span className="font-medium text-sm">{activeWorker.name}</span>
            <Badge variant="secondary" className="mr-2 text-xs">
              {activeWorker.rank_name}
            </Badge>
          </div>
        )}
      </DragOverlay>

      {/* Force assign modal */}
      <ForceAssignModal
        open={forceModal.open}
        onClose={() => setForceModal((p) => ({ ...p, open: false }))}
        onConfirm={(reason) => {
          handleAssign(forceModal.shiftDateId, forceModal.workerId, true, reason);
          setForceModal((p) => ({ ...p, open: false }));
        }}
        warnings={forceModal.warnings}
        workerName={forceModal.workerName}
      />
    </DndContext>
  );
}
