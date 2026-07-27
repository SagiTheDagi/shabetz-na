"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ForceAssignModal } from "@/components/force-assign-modal";
import { ExportImageModal, type ExportRow } from "@/components/export-image-modal";
import type { Quarter, AssignmentWarning } from "@/lib/types";

// ---- Interfaces ----

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
  worker_branch: string | null;
  is_forced: number;
  role: "shift" | "reserve";
}

interface WorkerSuggestion {
  worker_id: string;
  name: string;
  rank_id: string;
  rank_name: string;
  is_exempt: number;
  exemption_reason: string | null;
  receives_shift_allocation: number;
  branch: string | null;
  team: string | null;
  standing_constraints: string | null;
  notes: string | null;
  release_date: string | null;
  warnings: AssignmentWarning[];
  days_since_last_shift: number | null;
  assigned_this_quarter: boolean;
  availability_status: string | null;
  is_eligible: boolean;
  eligibility_priority: number | null;
}

// ---- Helpers ----

const HEBREW_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

function formatDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

function getDayName(iso: string) {
  return HEBREW_DAYS[new Date(iso + "T00:00:00").getDay()];
}

function getSeverityBorderClass(warnings: AssignmentWarning[]) {
  const order: Record<string, number> = { red: 3, amber: 2, orange: 1, green: 0 };
  const max = warnings.reduce(
    (m, w) => (order[w.severity] > order[m] ? w.severity : m),
    "green" as string
  );
  return (
    { red: "border-r-red-500", amber: "border-r-amber-500", orange: "border-r-orange-500", green: "border-r-green-500" }[max] ??
    "border-r-green-500"
  );
}

function getQuarterStartMonth(quarterId: string): { year: number; month: number } {
  const match = quarterId.match(/^(\d{4})-Q(\d)$/);
  if (!match) return { year: new Date().getFullYear(), month: 0 };
  return { year: parseInt(match[1]), month: (parseInt(match[2]) - 1) * 3 };
}

// ---- Worker Card (shared visual) ----

function WorkerCard({
  worker,
  onAssign,
  isDragging = false,
}: {
  worker: WorkerSuggestion;
  onAssign?: () => void;
  isDragging?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const borderClass = getSeverityBorderClass(worker.warnings);

  const hasExtra =
    worker.standing_constraints ||
    worker.notes ||
    worker.release_date ||
    (worker.is_exempt && worker.exemption_reason) ||
    worker.eligibility_priority !== null;

  return (
    <div
      className={`border rounded-lg border-r-4 ${borderClass} bg-card transition-shadow ${
        isDragging ? "opacity-50" : "hover:shadow-sm"
      }`}
    >
      <div className="p-2.5">
        {/* Row 1: name + rank + branch + team + buttons */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1 min-w-0">
            <span className="font-medium text-sm">{worker.name}</span>
            <Badge variant="secondary" className="text-xs shrink-0">
              {worker.rank_name}
            </Badge>
            {worker.branch && (
              <Badge variant="outline" className="text-xs shrink-0 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700">
                {worker.branch}
              </Badge>
            )}
            {worker.team && (
              <Badge variant="outline" className="text-xs shrink-0 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-700">
                {worker.team}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onAssign && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onAssign();
                }}
              >
                שבץ
              </Button>
            )}
            {hasExtra && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xs w-5 h-5 flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
              >
                {expanded ? "▲" : "▼"}
              </button>
            )}
          </div>
        </div>

        {/* Row 2: status badges */}
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
          {worker.is_exempt === 1 && (
            <span className="text-xs text-red-600 font-medium">⛔ פטור</span>
          )}
          {!worker.is_eligible && worker.is_exempt === 0 && (
            <span className="text-xs text-red-600">⛔ לא כשיר</span>
          )}
          {worker.availability_status === "prefer_work" && (
            <span className="text-xs text-green-600">🟢 מעדיף</span>
          )}
          {worker.availability_status === "prefer_not_work" && (
            <span className="text-xs text-orange-500">🟠 מעדיף לא</span>
          )}
          {worker.availability_status === "unavailable" && (
            <span className="text-xs text-red-600">🔴 לא יכול</span>
          )}
          {worker.assigned_this_quarter && (
            <span className="text-xs text-amber-600">✓ שובץ כבר</span>
          )}
          {worker.receives_shift_allocation === 0 && (
            <span className="text-xs text-muted-foreground">ללא הקצאה</span>
          )}
          {worker.days_since_last_shift !== null && (
            <span className="text-xs text-muted-foreground">
              {worker.days_since_last_shift} ימים מאז
            </span>
          )}
          {worker.eligibility_priority !== null && (
            <span className="text-xs text-muted-foreground">
              עדיפות {worker.eligibility_priority}
            </span>
          )}
        </div>

        {/* Expandable extra details */}
        {expanded && hasExtra && (
          <div className="mt-2 pt-2 border-t space-y-1">
            {worker.is_exempt === 1 && worker.exemption_reason && (
              <p className="text-xs">
                <span className="font-medium text-red-700 dark:text-red-400">פטור: </span>
                <span className="text-muted-foreground">{worker.exemption_reason}</span>
              </p>
            )}
            {worker.release_date && (
              <p className="text-xs">
                <span className="font-medium">שחרור: </span>
                <span className="text-muted-foreground">{worker.release_date}</span>
              </p>
            )}
            {worker.standing_constraints && (
              <p className="text-xs">
                <span className="font-medium">אילוצים קבועים: </span>
                <span className="text-muted-foreground">{worker.standing_constraints}</span>
              </p>
            )}
            {worker.notes && (
              <p className="text-xs">
                <span className="font-medium">הערות: </span>
                <span className="text-muted-foreground">{worker.notes}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Draggable wrapper ----

function DraggableWorkerCard({
  worker,
  onAssign,
}: {
  worker: WorkerSuggestion;
  onAssign?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `worker-${worker.worker_id}`,
    data: worker,
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className="cursor-grab active:cursor-grabbing">
      <WorkerCard worker={worker} onAssign={onAssign} isDragging={isDragging} />
    </div>
  );
}

// ---- Assignment slot sub-component (droppable) ----

function AssignmentSlot({
  shiftDateId,
  role,
  assignment,
  isActiveSlot,
  onClick,
  onUnassign,
}: {
  shiftDateId: string;
  role: "shift" | "reserve";
  assignment: AssignmentRow | null;
  isActiveSlot: boolean;
  onClick: () => void;
  onUnassign: (assignmentId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot-${shiftDateId}-${role}`,
    data: { shiftId: shiftDateId, role },
  });

  const label = role === "shift" ? "משמרת" : "רזרבה";

  return (
    <div
      ref={setNodeRef}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex items-center justify-between px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
        isOver
          ? "bg-green-100 dark:bg-green-900/40 ring-1 ring-green-400"
          : isActiveSlot
          ? "bg-primary/10 ring-1 ring-primary"
          : "hover:bg-muted/60"
      }`}
    >
      <span className={`font-medium shrink-0 ${role === "reserve" ? "text-muted-foreground" : ""}`}>
        {label}:
      </span>
      {assignment ? (
        <div className="flex items-center gap-1 min-w-0 ms-1">
          <span className={`truncate ${role === "shift" ? "text-green-700 dark:text-green-400" : "text-blue-700 dark:text-blue-400"}`}>
            {assignment.worker_name}
          </span>
          {assignment.is_forced === 1 && (
            <Badge variant="destructive" className="text-xs shrink-0 h-4 px-1">כפוי</Badge>
          )}
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-red-500 ms-auto"
            onClick={(e) => { e.stopPropagation(); onUnassign(assignment.assignment_id); }}
          >
            ✕
          </button>
        </div>
      ) : (
        <span className="text-muted-foreground ms-1">—</span>
      )}
    </div>
  );
}

// ---- Droppable Shift Card (list view) ----

function DroppableShiftCard({
  shift,
  shiftAssignment,
  reserveAssignment,
  isSelected,
  selectedRole,
  onSelectSlot,
  onUnassign,
}: {
  shift: ShiftDateRow;
  shiftAssignment: AssignmentRow | null;
  reserveAssignment: AssignmentRow | null;
  isSelected: boolean;
  selectedRole: "shift" | "reserve";
  onSelectSlot: (role: "shift" | "reserve") => void;
  onUnassign: (assignmentId: string) => void;
}) {
  const bothFilled = !!(shiftAssignment && reserveAssignment);
  const noneFilled = !shiftAssignment && !reserveAssignment;

  return (
    <div
      className={`p-3 border rounded-lg transition-all ${
        isSelected
          ? "ring-2 ring-primary bg-primary/5"
          : bothFilled
          ? "bg-green-50/60 dark:bg-green-950/20 border-green-200 dark:border-green-900"
          : !noneFilled
          ? "bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900"
          : "bg-card hover:bg-muted/50"
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="font-medium text-sm">
          {formatDate(shift.date)} {getDayName(shift.date)}
        </span>
        <Badge variant="outline" className="text-xs">{shift.shift_type_name}</Badge>
        {shift.is_weekend === 1 && shift.shift_type_id !== "GUARD" && (
          <Badge className="text-xs bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
            סופ&quot;ש
          </Badge>
        )}
        {bothFilled && <span className="text-xs text-green-600 ms-auto">✅ מלא</span>}
        {!noneFilled && !bothFilled && <span className="text-xs text-amber-600 ms-auto">⚡ חלקי</span>}
      </div>

      {/* Slots */}
      <div className="space-y-1">
        <AssignmentSlot
          shiftDateId={shift.shift_date_id}
          role="shift"
          assignment={shiftAssignment}
          isActiveSlot={isSelected && selectedRole === "shift"}
          onClick={() => onSelectSlot("shift")}
          onUnassign={onUnassign}
        />
        <AssignmentSlot
          shiftDateId={shift.shift_date_id}
          role="reserve"
          assignment={reserveAssignment}
          isActiveSlot={isSelected && selectedRole === "reserve"}
          onClick={() => onSelectSlot("reserve")}
          onUnassign={onUnassign}
        />
      </div>
    </div>
  );
}

// ---- Shift List Panel ----

type ShiftStatusFilter = "all" | "full" | "partial" | "empty";

interface ShiftFilters {
  typeId: string;
  weekend: "all" | "yes" | "no";
  status: ShiftStatusFilter;
}

function ShiftListPanel({
  shiftDates,
  assignments,
  selectedShiftId,
  selectedRole,
  onSelectSlot,
  onUnassign,
}: {
  shiftDates: ShiftDateRow[];
  assignments: AssignmentRow[];
  selectedShiftId: string | null;
  selectedRole: "shift" | "reserve";
  onSelectSlot: (shiftId: string, role: "shift" | "reserve") => void;
  onUnassign: (assignmentId: string) => void;
}) {
  const [filters, setFilters] = useState<ShiftFilters>({
    typeId: "",
    weekend: "all",
    status: "all",
  });

  const shiftTypes = useMemo(
    () => Array.from(new Set(shiftDates.map((s) => s.shift_type_name))).sort(),
    [shiftDates]
  );

  const getSlotAssignment = (shiftDateId: string, role: "shift" | "reserve") =>
    assignments.find((a) => a.shift_date_id === shiftDateId && a.role === role) ?? null;

  const filtered = useMemo(() => {
    let list = shiftDates;
    if (filters.typeId) list = list.filter((s) => s.shift_type_name === filters.typeId);
    if (filters.weekend === "yes") list = list.filter((s) => s.is_weekend === 1);
    if (filters.weekend === "no") list = list.filter((s) => s.is_weekend === 0);
    if (filters.status === "full")
      list = list.filter((s) =>
        assignments.some((a) => a.shift_date_id === s.shift_date_id && a.role === "shift") &&
        assignments.some((a) => a.shift_date_id === s.shift_date_id && a.role === "reserve")
      );
    if (filters.status === "partial")
      list = list.filter((s) => {
        const count = assignments.filter((a) => a.shift_date_id === s.shift_date_id).length;
        return count === 1;
      });
    if (filters.status === "empty")
      list = list.filter((s) => !assignments.some((a) => a.shift_date_id === s.shift_date_id));
    return list;
  }, [shiftDates, filters, assignments]);

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-2">
      {/* Filter bar */}
      <div className="shrink-0 flex gap-1.5 flex-wrap items-center">
        <span className="text-xs font-semibold text-muted-foreground">
          משמרות ({filtered.length}/{shiftDates.length})
        </span>
        <Select
          value={filters.typeId || "all"}
          onValueChange={(v) => setFilters((f) => ({ ...f, typeId: v === "all" ? "" : (v ?? "") }))}
        >
          <SelectTrigger className="h-7 text-xs w-32">
            <SelectValue placeholder="סוג משמרת" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסוגים</SelectItem>
            {shiftTypes.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.weekend}
          onValueChange={(v) => setFilters((f) => ({ ...f, weekend: v as ShiftFilters["weekend"] }))}
        >
          <SelectTrigger className="h-7 text-xs w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הימים</SelectItem>
            <SelectItem value="yes">סופ&quot;ש</SelectItem>
            <SelectItem value="no">חול</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.status}
          onValueChange={(v) => setFilters((f) => ({ ...f, status: v as ShiftStatusFilter }))}
        >
          <SelectTrigger className="h-7 text-xs w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">הכל</SelectItem>
            <SelectItem value="full">מלא</SelectItem>
            <SelectItem value="partial">חלקי</SelectItem>
            <SelectItem value="empty">ריק</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Shift list */}
      <div className="flex-1 overflow-auto space-y-1.5 pe-1">
        {shiftDates.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            אין תאריכי משמרות. העלה קובץ תאריכים קודם.
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">אין תוצאות לפילטר</p>
        ) : (
          filtered.map((sd) => (
            <DroppableShiftCard
              key={sd.shift_date_id}
              shift={sd}
              shiftAssignment={getSlotAssignment(sd.shift_date_id, "shift")}
              reserveAssignment={getSlotAssignment(sd.shift_date_id, "reserve")}
              isSelected={selectedShiftId === sd.shift_date_id}
              selectedRole={selectedRole}
              onSelectSlot={(role) => onSelectSlot(sd.shift_date_id, role)}
              onUnassign={onUnassign}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---- Worker Panel (right side) ----

type WorkerSortKey = "default" | "name" | "days" | "priority";

function WorkerPanel({
  workers,
  selectedShiftId,
  selectedRole,
  onRoleChange,
  onAssign,
  viewMode,
}: {
  workers: WorkerSuggestion[];
  selectedShiftId: string | null;
  selectedRole: "shift" | "reserve";
  onRoleChange: (role: "shift" | "reserve") => void;
  onAssign: (workerId: string) => void;
  viewMode: "list" | "calendar";
}) {
  const [rankFilter, setRankFilter] = useState("");
  const [availFilter, setAvailFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [showExempt, setShowExempt] = useState(true);
  const [sortKey, setSortKey] = useState<WorkerSortKey>("default");

  const ranks = useMemo(
    () => Array.from(new Set(workers.map((w) => w.rank_name))).sort(),
    [workers]
  );
  const branches = useMemo(
    () => Array.from(new Set(workers.map((w) => w.branch).filter((b): b is string => !!b))).sort(),
    [workers]
  );
  const teams = useMemo(
    () => Array.from(new Set(workers.map((w) => w.team).filter((t): t is string => !!t))).sort(),
    [workers]
  );

  const filteredWorkers = useMemo(() => {
    let list = workers;
    if (!showExempt) list = list.filter((w) => w.is_exempt === 0);
    if (rankFilter) list = list.filter((w) => w.rank_name === rankFilter);
    if (availFilter) list = list.filter((w) => w.availability_status === availFilter);
    if (branchFilter) list = list.filter((w) => w.branch === branchFilter);
    if (teamFilter) list = list.filter((w) => w.team === teamFilter);

    if (sortKey === "name") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name, "he"));
    } else if (sortKey === "days") {
      list = [...list].sort(
        (a, b) => (b.days_since_last_shift ?? -1) - (a.days_since_last_shift ?? -1)
      );
    } else if (sortKey === "priority") {
      list = [...list].sort(
        (a, b) => (a.eligibility_priority ?? 999) - (b.eligibility_priority ?? 999)
      );
    }
    return list;
  }, [workers, showExempt, rankFilter, availFilter, branchFilter, teamFilter, sortKey]);

  const clearFilters = () => {
    setRankFilter("");
    setAvailFilter("");
    setBranchFilter("");
    setTeamFilter("");
    setShowExempt(true);
    setSortKey("default");
  };

  if (!selectedShiftId) {
    return (
      <div className="flex-none w-72 border-s ps-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground text-center">
          בחר משמרת כדי לראות עובדים
        </p>
      </div>
    );
  }

  return (
    <div className="flex-none w-72 border-s ps-3 flex flex-col min-h-0 gap-2">
      {/* Role toggle */}
      <div className="shrink-0 flex rounded-md border overflow-hidden text-xs">
        <button
          type="button"
          className={`flex-1 px-3 py-1.5 transition-colors font-medium ${
            selectedRole === "shift"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted"
          }`}
          onClick={() => onRoleChange("shift")}
        >
          משמרת
        </button>
        <button
          type="button"
          className={`flex-1 px-3 py-1.5 transition-colors font-medium border-s ${
            selectedRole === "reserve"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted"
          }`}
          onClick={() => onRoleChange("reserve")}
        >
          רזרבה
        </button>
      </div>

      {/* Header + clear */}
      <div className="shrink-0 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">
          עובדים ({filteredWorkers.length}/{workers.length})
        </span>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={clearFilters}
        >
          נקה פילטרים
        </button>
      </div>

      {/* Rank + availability row */}
      <div className="shrink-0 flex gap-1">
        <Select
          value={rankFilter || "all"}
          onValueChange={(v) => setRankFilter(v === "all" ? "" : (v ?? ""))}
        >
          <SelectTrigger className="h-7 text-xs flex-1">
            <SelectValue placeholder="דרגה" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הדרגות</SelectItem>
            {ranks.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={availFilter || "all"}
          onValueChange={(v) => setAvailFilter(v === "all" ? "" : (v ?? ""))}
        >
          <SelectTrigger className="h-7 text-xs flex-1">
            <SelectValue placeholder="זמינות" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הזמינות</SelectItem>
            <SelectItem value="prefer_work">מעדיף</SelectItem>
            <SelectItem value="prefer_not_work">מעדיף לא</SelectItem>
            <SelectItem value="unavailable">לא יכול</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Branch + team row */}
      {(branches.length > 0 || teams.length > 0) && (
        <div className="shrink-0 flex gap-1">
          {branches.length > 0 && (
            <Select
              value={branchFilter || "all"}
              onValueChange={(v) => setBranchFilter(v === "all" ? "" : (v ?? ""))}
            >
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue placeholder="ענף" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הענפים</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {teams.length > 0 && (
            <Select
              value={teamFilter || "all"}
              onValueChange={(v) => setTeamFilter(v === "all" ? "" : (v ?? ""))}
            >
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue placeholder="צוות" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הצוותים</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {/* Sort + exempt toggle */}
      <div className="shrink-0 flex gap-1">
        <Select value={sortKey} onValueChange={(v) => setSortKey(v as WorkerSortKey)}>
          <SelectTrigger className="h-7 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">מיון אוטומטי</SelectItem>
            <SelectItem value="name">לפי שם</SelectItem>
            <SelectItem value="days">לפי ימים מאז</SelectItem>
            <SelectItem value="priority">לפי עדיפות</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant={showExempt ? "outline" : "secondary"}
          className="h-7 text-xs px-2 shrink-0"
          onClick={() => setShowExempt((v) => !v)}
        >
          {showExempt ? "הסתר פטורים" : "הצג פטורים"}
        </Button>
      </div>

      {/* Worker list */}
      <div className="flex-1 overflow-auto space-y-1.5">
        {filteredWorkers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">אין עובדים תואמים</p>
        ) : viewMode === "list" ? (
          filteredWorkers.map((w) => (
            <DraggableWorkerCard
              key={w.worker_id}
              worker={w}
              onAssign={() => onAssign(w.worker_id)}
            />
          ))
        ) : (
          filteredWorkers.map((w) => (
            <WorkerCard
              key={w.worker_id}
              worker={w}
              onAssign={() => onAssign(w.worker_id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---- Calendar View ----

function CalendarView({
  shiftDates,
  assignments,
  selectedShiftId,
  selectedRole,
  onSelectSlot,
  onUnassign,
  calendarMonth,
  onMonthChange,
}: {
  shiftDates: ShiftDateRow[];
  assignments: AssignmentRow[];
  selectedShiftId: string | null;
  selectedRole: "shift" | "reserve";
  onSelectSlot: (shiftId: string, role: "shift" | "reserve") => void;
  onUnassign: (assignmentId: string) => void;
  calendarMonth: { year: number; month: number };
  onMonthChange: (m: { year: number; month: number }) => void;
}) {
  const { year, month } = calendarMonth;
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Array<number | null> = [
    ...Array<null>(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: Array<Array<number | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  function toDateStr(day: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function prevMonth() {
    onMonthChange(month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 });
  }
  function nextMonth() {
    onMonthChange(month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 });
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-2">
      {/* Month nav */}
      <div className="shrink-0 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={prevMonth}>▶</Button>
        <span className="font-semibold text-sm">
          {HEBREW_MONTHS[month]} {year}
        </span>
        <Button variant="ghost" size="sm" onClick={nextMonth}>◀</Button>
      </div>

      {/* Day headers */}
      <div className="shrink-0 grid grid-cols-7 gap-0.5">
        {HEBREW_DAYS.map((d, i) => (
          <div
            key={i}
            className={`text-center text-xs font-medium py-1 rounded ${
              i === 6
                ? "text-purple-600 dark:text-purple-400"
                : i === 5
                ? "text-orange-500"
                : "text-muted-foreground"
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto space-y-0.5">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-0.5">
            {week.map((day, di) => {
              if (!day) {
                return <div key={di} className="min-h-20 rounded bg-muted/20" />;
              }

              const dateStr = toDateStr(day);
              const dayShifts = shiftDates.filter((s) => s.date === dateStr);
              const dayOfWeek = new Date(year, month, day).getDay();
              const isWeekend = dayOfWeek >= 5;

              return (
                <div
                  key={di}
                  className={`min-h-20 rounded border p-1 ${
                    isWeekend
                      ? "bg-purple-50/60 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900"
                      : "bg-card border-border"
                  }`}
                >
                  <span
                    className={`text-xs font-medium block mb-0.5 ${
                      isWeekend ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground"
                    }`}
                  >
                    {day}
                  </span>
                  <div className="space-y-0.5">
                    {dayShifts.map((shift) => {
                      const shiftA = assignments.find(
                        (a) => a.shift_date_id === shift.shift_date_id && a.role === "shift"
                      );
                      const reserveA = assignments.find(
                        (a) => a.shift_date_id === shift.shift_date_id && a.role === "reserve"
                      );
                      const isSelected = selectedShiftId === shift.shift_date_id;

                      return (
                        <div
                          key={shift.shift_date_id}
                          className={`w-full text-right text-xs px-1 py-0.5 rounded transition-colors leading-tight ${
                            isSelected
                              ? "bg-primary/10 ring-1 ring-primary"
                              : "bg-muted hover:bg-muted/60"
                          }`}
                        >
                          <div className="font-medium truncate text-muted-foreground">{shift.shift_type_name}</div>
                          {/* Shift slot */}
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelectSlot(shift.shift_date_id, "shift")}
                            onKeyDown={(e) => e.key === "Enter" && onSelectSlot(shift.shift_date_id, "shift")}
                            className={`flex items-center justify-between gap-0.5 cursor-pointer rounded px-0.5 ${
                              isSelected && selectedRole === "shift" ? "bg-primary/20" : "hover:bg-muted"
                            }`}
                          >
                            {shiftA ? (
                              <>
                                <span className="truncate text-green-700 dark:text-green-400">{shiftA.worker_name}</span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onUnassign(shiftA.assignment_id); }}
                                  className="shrink-0 opacity-60 hover:opacity-100 hover:text-red-600"
                                >
                                  ✕
                                </button>
                              </>
                            ) : (
                              <span className="opacity-40">משמרת —</span>
                            )}
                          </div>
                          {/* Reserve slot */}
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelectSlot(shift.shift_date_id, "reserve")}
                            onKeyDown={(e) => e.key === "Enter" && onSelectSlot(shift.shift_date_id, "reserve")}
                            className={`flex items-center justify-between gap-0.5 cursor-pointer rounded px-0.5 ${
                              isSelected && selectedRole === "reserve" ? "bg-primary/20" : "hover:bg-muted"
                            }`}
                          >
                            {reserveA ? (
                              <>
                                <span className="truncate text-blue-700 dark:text-blue-400">{reserveA.worker_name}</span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onUnassign(reserveA.assignment_id); }}
                                  className="shrink-0 opacity-60 hover:opacity-100 hover:text-red-600"
                                >
                                  ✕
                                </button>
                              </>
                            ) : (
                              <span className="opacity-40">רזרבה —</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Main Page ----

export default function AssignPage() {
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [selectedQuarter, setSelectedQuarter] = useState<string>("");
  const [shiftDates, setShiftDates] = useState<ShiftDateRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<"shift" | "reserve">("shift");
  const [workers, setWorkers] = useState<WorkerSuggestion[]>([]);
  const [activeWorker, setActiveWorker] = useState<WorkerSuggestion | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [exportImageOpen, setExportImageOpen] = useState(false);

  const [forceModal, setForceModal] = useState<{
    open: boolean;
    shiftDateId: string;
    workerId: string;
    workerName: string;
    warnings: AssignmentWarning[];
    role: "shift" | "reserve";
  }>({ open: false, shiftDateId: "", workerId: "", workerName: "", warnings: [], role: "shift" });

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

  useEffect(() => {
    if (selectedQuarter) {
      setCalendarMonth(getQuarterStartMonth(selectedQuarter));
      setSelectedShiftId(null);
      setSelectedRole("shift");
    }
  }, [selectedQuarter]);

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
      `/api/assignments/warnings?shift_date_id=${selectedShiftId}&role=${selectedRole}`
    );
    setWorkers(await res.json());
  }, [selectedShiftId, selectedRole]);

  useEffect(() => {
    loadWorkers();
  }, [loadWorkers]);

  function handleSelectSlot(shiftId: string, role: "shift" | "reserve") {
    setSelectedShiftId(shiftId);
    setSelectedRole(role);
  }

  async function handleAssign(
    shiftDateId: string,
    workerId: string,
    role: "shift" | "reserve",
    isForced = false,
    forceReason?: string
  ) {
    const res = await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shift_date_id: shiftDateId,
        worker_id: workerId,
        role,
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
        workerName: worker?.name ?? workerId,
        warnings: data.warnings,
        role,
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

  async function handleUnassign(assignmentId: string) {
    const res = await fetch(`/api/assignments?assignment_id=${assignmentId}`, {
      method: "DELETE",
    });
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
    const { shiftId, role } = over.data.current as { shiftId: string; role: "shift" | "reserve" };
    handleAssign(shiftId, workerId, role);
  }

  async function handleExport() {
    if (!selectedQuarter) return;
    const res = await fetch(`/api/export?quarter_id=${selectedQuarter}`);
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
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

  const fullyAssignedCount = useMemo(() => {
    const shiftIds = new Set(
      assignments.filter((a) => a.role === "shift").map((a) => a.shift_date_id)
    );
    const reserveIds = new Set(
      assignments.filter((a) => a.role === "reserve").map((a) => a.shift_date_id)
    );
    return shiftDates.filter((sd) => shiftIds.has(sd.shift_date_id) && reserveIds.has(sd.shift_date_id)).length;
  }, [assignments, shiftDates]);

  const exportRows: ExportRow[] = useMemo(
    () =>
      shiftDates.map((sd) => {
        const shiftA = assignments.find((x) => x.shift_date_id === sd.shift_date_id && x.role === "shift");
        const reserveA = assignments.find((x) => x.shift_date_id === sd.shift_date_id && x.role === "reserve");
        return {
          date: sd.date,
          shift_type_name: sd.shift_type_name,
          is_weekend: sd.is_weekend === 1,
          shift_worker_name: shiftA?.worker_name ?? null,
          shift_is_forced: shiftA?.is_forced === 1,
          reserve_worker_name: reserveA?.worker_name ?? null,
          reserve_is_forced: reserveA?.is_forced === 1,
        };
      }),
    [shiftDates, assignments]
  );
  const totalCount = shiftDates.length;

  const selectedShift = shiftDates.find((s) => s.shift_date_id === selectedShiftId);

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-full gap-3">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
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
              {fullyAssignedCount}/{totalCount} שובצו במלואן
            </span>
            {/* View toggle */}
            <div className="flex rounded-md border overflow-hidden text-sm">
              <button
                type="button"
                className={`px-3 py-1 transition-colors ${
                  viewMode === "list"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => setViewMode("list")}
              >
                רשימה
              </button>
              <button
                type="button"
                className={`px-3 py-1 transition-colors border-s ${
                  viewMode === "calendar"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => setViewMode("calendar")}
              >
                לוח שנה
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportImageOpen(true)}
              disabled={shiftDates.length === 0}
            >
              ייצוא תמונה
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              ייצוא JSON
            </Button>
            <Button variant="outline" size="sm" onClick={handleImport}>
              ייבוא JSON
            </Button>
          </div>
        </div>

        {/* Selected shift label (calendar mode) */}
        {viewMode === "calendar" && selectedShift && (
          <div className="shrink-0 text-sm text-muted-foreground">
            משמרת נבחרת:{" "}
            <span className="font-medium text-foreground">
              {formatDate(selectedShift.date)} {getDayName(selectedShift.date)} — {selectedShift.shift_type_name}
            </span>
            <span className="ms-2 text-xs font-medium text-primary">
              ({selectedRole === "shift" ? "משמרת" : "רזרבה"})
            </span>
          </div>
        )}

        {/* Main content */}
        <div className="flex gap-3 flex-1 min-h-0">
          {viewMode === "list" ? (
            <ShiftListPanel
              shiftDates={shiftDates}
              assignments={assignments}
              selectedShiftId={selectedShiftId}
              selectedRole={selectedRole}
              onSelectSlot={handleSelectSlot}
              onUnassign={handleUnassign}
            />
          ) : (
            <CalendarView
              shiftDates={shiftDates}
              assignments={assignments}
              selectedShiftId={selectedShiftId}
              selectedRole={selectedRole}
              onSelectSlot={handleSelectSlot}
              onUnassign={handleUnassign}
              calendarMonth={calendarMonth}
              onMonthChange={setCalendarMonth}
            />
          )}

          <WorkerPanel
            workers={workers}
            selectedShiftId={selectedShiftId}
            selectedRole={selectedRole}
            onRoleChange={setSelectedRole}
            onAssign={(workerId) => {
              if (selectedShiftId) handleAssign(selectedShiftId, workerId, selectedRole);
            }}
            viewMode={viewMode}
          />
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeWorker && (
          <div className="p-2.5 bg-card border rounded-lg shadow-lg opacity-90 border-r-4 border-r-primary max-w-56">
            <span className="font-medium text-sm">{activeWorker.name}</span>
            <Badge variant="secondary" className="me-2 text-xs">
              {activeWorker.rank_name}
            </Badge>
          </div>
        )}
      </DragOverlay>

      <ForceAssignModal
        open={forceModal.open}
        onClose={() => setForceModal((p) => ({ ...p, open: false }))}
        onConfirm={(reason) => {
          handleAssign(forceModal.shiftDateId, forceModal.workerId, forceModal.role, true, reason);
          setForceModal((p) => ({ ...p, open: false }));
        }}
        warnings={forceModal.warnings}
        workerName={forceModal.workerName}
      />

      <ExportImageModal
        open={exportImageOpen}
        onClose={() => setExportImageOpen(false)}
        rows={exportRows}
        quarterId={selectedQuarter}
      />
    </DndContext>
  );
}
