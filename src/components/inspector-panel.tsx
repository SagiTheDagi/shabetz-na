"use client";

import { useState, useEffect } from "react";
import { X, Phone, AlertTriangle, MessageCircle, Users, Clock, FileText, Save, Archive, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export interface InspectorWorkerData {
  worker_id: string;
  name: string;
  rank_id?: string;
  rank_name: string;
  is_exempt: number;
  exemption_reason: string | null;
  receives_shift_allocation: number;
  release_date: string | null;
  branch: string | null;
  team: string | null;
  phone: string | null;
  notes: string | null;
  standing_constraints: string | null;
  in_whatsapp_group?: number;
  is_archived?: number;
  days_since_last_shift?: number | null;
  assigned_this_quarter?: boolean;
  total_shifts_last_year?: number;
  weekend_shifts_last_year?: number;
}

export interface InspectorShiftData {
  shift_date_id: string;
  date: string;
  shift_type_name: string;
  is_weekend: number;
  assigned_worker?: {
    worker_id: string;
    name: string;
    rank_name: string;
  } | null;
  reserve_worker?: {
    worker_id: string;
    name: string;
    rank_name: string;
  } | null;
}

interface InspectorPanelProps {
  type: "worker" | "shift";
  worker?: InspectorWorkerData | null;
  shift?: InspectorShiftData | null;
  onClose: () => void;
  onAssign?: (workerId: string) => void;
  onUnassign?: (assignmentId: string) => void;
  onWorkerUpdate?: (worker: InspectorWorkerData) => void;
  editable?: boolean;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  return `יום ${days[d.getDay()]}, ${d.toLocaleDateString("he-IL")}`;
}

function ToggleButton({ 
  checked, 
  onChange, 
  label,
  activeColor = "green"
}: { 
  checked: boolean; 
  onChange: (val: boolean) => void; 
  label: string;
  activeColor?: "green" | "amber" | "red";
}) {
  const colors = {
    green: "bg-green-500/20 border-green-500/30 text-green-400",
    amber: "bg-amber-500/20 border-amber-500/30 text-amber-400",
    red: "bg-red-500/20 border-red-500/30 text-red-400",
  };
  
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] transition-colors ${
        checked 
          ? colors[activeColor]
          : "bg-white/[0.02] border-white/10 nocturne-text-muted hover:bg-white/[0.04]"
      }`}
    >
      <span className={`w-4 h-4 rounded border flex items-center justify-center ${
        checked 
          ? activeColor === "green" ? "bg-green-500 border-green-500" : activeColor === "amber" ? "bg-amber-500 border-amber-500" : "bg-red-500 border-red-500"
          : "border-white/20"
      }`}>
        {checked && <span className="text-white text-[10px]">✓</span>}
      </span>
      {label}
    </button>
  );
}

export function InspectorPanel({ 
  type, 
  worker, 
  shift, 
  onClose, 
  onAssign,
  onWorkerUpdate,
  editable = false 
}: InspectorPanelProps) {
  // Editable state
  const [editedPhone, setEditedPhone] = useState(worker?.phone ?? "");
  const [editedBranch, setEditedBranch] = useState(worker?.branch ?? "");
  const [editedTeam, setEditedTeam] = useState(worker?.team ?? "");
  const [editedNotes, setEditedNotes] = useState(worker?.notes ?? "");
  const [editedConstraints, setEditedConstraints] = useState(worker?.standing_constraints ?? "");
  const [editedExempt, setEditedExempt] = useState(worker?.is_exempt === 1);
  const [editedExemptReason, setEditedExemptReason] = useState(worker?.exemption_reason ?? "");
  const [editedWhatsapp, setEditedWhatsapp] = useState(worker?.in_whatsapp_group === 1);
  const [editedAllocation, setEditedAllocation] = useState(worker?.receives_shift_allocation === 1);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Reset state when worker changes
  useEffect(() => {
    if (worker) {
      setEditedPhone(worker.phone ?? "");
      setEditedBranch(worker.branch ?? "");
      setEditedTeam(worker.team ?? "");
      setEditedNotes(worker.notes ?? "");
      setEditedConstraints(worker.standing_constraints ?? "");
      setEditedExempt(worker.is_exempt === 1);
      setEditedExemptReason(worker.exemption_reason ?? "");
      setEditedWhatsapp(worker.in_whatsapp_group === 1);
      setEditedAllocation(worker.receives_shift_allocation === 1);
      setHasChanges(false);
    }
    // Reset only when switching to a different worker, not on every field update to `worker`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worker?.worker_id]);

  // Track changes
  useEffect(() => {
    if (!worker || !editable) return;
    const changed = 
      editedPhone !== (worker.phone ?? "") ||
      editedBranch !== (worker.branch ?? "") ||
      editedTeam !== (worker.team ?? "") ||
      editedNotes !== (worker.notes ?? "") ||
      editedConstraints !== (worker.standing_constraints ?? "") ||
      editedExempt !== (worker.is_exempt === 1) ||
      editedExemptReason !== (worker.exemption_reason ?? "") ||
      editedWhatsapp !== (worker.in_whatsapp_group === 1) ||
      editedAllocation !== (worker.receives_shift_allocation === 1);
    setHasChanges(changed);
  }, [editedPhone, editedBranch, editedTeam, editedNotes, editedConstraints, editedExempt, editedExemptReason, editedWhatsapp, editedAllocation, worker, editable]);

  async function handleSave() {
    if (!worker) return;
    setSaving(true);
    
    try {
      const res = await fetch(`/api/workers/${worker.worker_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: editedPhone || null,
          branch: editedBranch || null,
          team: editedTeam || null,
          notes: editedNotes || null,
          standing_constraints: editedConstraints || null,
          is_exempt: editedExempt,
          exemption_reason: editedExempt ? editedExemptReason : null,
          in_whatsapp_group: editedWhatsapp,
          receives_shift_allocation: editedAllocation,
        }),
      });

      if (res.ok) {
        toast.success("פרטי העובד נשמרו");
        setHasChanges(false);
        // Notify parent of update
        if (onWorkerUpdate) {
          onWorkerUpdate({
            ...worker,
            phone: editedPhone || null,
            branch: editedBranch || null,
            team: editedTeam || null,
            notes: editedNotes || null,
            standing_constraints: editedConstraints || null,
            is_exempt: editedExempt ? 1 : 0,
            exemption_reason: editedExempt ? editedExemptReason : null,
            in_whatsapp_group: editedWhatsapp ? 1 : 0,
            receives_shift_allocation: editedAllocation ? 1 : 0,
          });
        }
      } else {
        const err = await res.json();
        toast.error(err.error || "שגיאה בשמירה");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!worker) return;
    if (!confirm("האם להעביר את העובד לארכיון?")) return;
    
    const res = await fetch(`/api/workers/${worker.worker_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_archived: true }),
    });

    if (res.ok) {
      toast.success("העובד הועבר לארכיון");
      if (onWorkerUpdate) {
        onWorkerUpdate({ ...worker, is_archived: 1 });
      }
      onClose();
    }
  }

  async function handleRestore() {
    if (!worker) return;
    
    const res = await fetch(`/api/workers/${worker.worker_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_archived: false }),
    });

    if (res.ok) {
      toast.success("העובד שוחזר מהארכיון");
      if (onWorkerUpdate) {
        onWorkerUpdate({ ...worker, is_archived: 0 });
      }
    }
  }

  if (type === "worker" && worker) {
    return (
      <div className="h-full flex flex-col nocturne-surface border-r border-white/5">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full grid place-items-center text-sm font-medium nocturne-accent-muted nocturne-accent-light">
              {worker.name.charAt(0)}
            </span>
            <div className="flex flex-col">
              <span className="text-[15px] font-medium">{worker.name}</span>
              <span className="text-[12px] nocturne-text-muted">{worker.rank_name}</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Worker ID - always read-only */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-wide nocturne-text-muted flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              מספר אישי
            </label>
            <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 text-[13px] font-mono">
              {worker.worker_id}
            </div>
          </div>

          {/* Status toggles */}
          {editable && (
            <div className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-wide nocturne-text-muted">סטטוס</label>
              <div className="flex flex-wrap gap-2">
                <ToggleButton
                  checked={editedWhatsapp}
                  onChange={setEditedWhatsapp}
                  label="בקבוצת וואטסאפ"
                  activeColor="green"
                />
                <ToggleButton
                  checked={editedAllocation}
                  onChange={setEditedAllocation}
                  label="מקבל הקצאה"
                  activeColor="green"
                />
                <ToggleButton
                  checked={editedExempt}
                  onChange={setEditedExempt}
                  label="פטור ממשמרות"
                  activeColor="red"
                />
              </div>
            </div>
          )}

          {/* Status badges - read only mode */}
          {!editable && (
            <div className="flex flex-wrap gap-2">
              {worker.is_exempt === 1 && (
                <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] bg-red-500/10 text-red-400 border border-red-500/20">
                  <AlertTriangle className="h-3 w-3" />
                  פטור
                </span>
              )}
              {worker.in_whatsapp_group === 1 ? (
                <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] bg-green-500/10 text-green-400 border border-green-500/20">
                  <MessageCircle className="h-3 w-3" />
                  בקבוצת וואטסאפ
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <MessageCircle className="h-3 w-3" />
                  לא בקבוצה
                </span>
              )}
              {worker.receives_shift_allocation === 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] bg-gray-500/10 text-gray-400 border border-gray-500/20">
                  לא מקבל הקצאה
                </span>
              )}
            </div>
          )}

          {/* Exemption reason */}
          {editable && editedExempt && (
            <div className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-wide text-red-400">סיבת פטור</label>
              <textarea
                value={editedExemptReason}
                onChange={(e) => setEditedExemptReason(e.target.value)}
                placeholder="הזן סיבת פטור..."
                className="w-full px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20 text-[13px] resize-none h-20 focus:outline-none focus:border-red-500/40"
              />
            </div>
          )}

          {!editable && worker.is_exempt === 1 && worker.exemption_reason && (
            <div className="space-y-2 p-3 rounded-lg bg-red-500/5 border border-red-500/10">
              <h4 className="text-[11px] font-medium uppercase tracking-wide text-red-400">סיבת פטור</h4>
              <p className="text-[13px]">{worker.exemption_reason}</p>
            </div>
          )}

          {/* Phone */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-wide nocturne-text-muted flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" />
              טלפון
            </label>
            {editable ? (
              <input
                type="tel"
                value={editedPhone}
                onChange={(e) => setEditedPhone(e.target.value)}
                placeholder="050-0000000"
                dir="ltr"
                className="w-full px-3 py-2 rounded-lg bg-white/[0.02] border border-white/10 text-[13px] focus:outline-none focus:border-white/20"
              />
            ) : (
              <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 text-[13px]" dir="ltr">
                {worker.phone || "—"}
              </div>
            )}
          </div>

          {/* Branch & Team */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-wide nocturne-text-muted">ענף</label>
              {editable ? (
                <input
                  type="text"
                  value={editedBranch}
                  onChange={(e) => setEditedBranch(e.target.value)}
                  placeholder="ענף"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.02] border border-white/10 text-[13px] focus:outline-none focus:border-white/20"
                />
              ) : (
                <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 text-[13px]">
                  {worker.branch || "—"}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-wide nocturne-text-muted">צוות</label>
              {editable ? (
                <input
                  type="text"
                  value={editedTeam}
                  onChange={(e) => setEditedTeam(e.target.value)}
                  placeholder="צוות"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.02] border border-white/10 text-[13px] focus:outline-none focus:border-white/20"
                />
              ) : (
                <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 text-[13px]">
                  {worker.team || "—"}
                </div>
              )}
            </div>
          </div>

          {/* Standing constraints */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-wide nocturne-text-muted">אילוצים קבועים</label>
            {editable ? (
              <textarea
                value={editedConstraints}
                onChange={(e) => setEditedConstraints(e.target.value)}
                placeholder="למשל: ימי ראשון לימודים, לא יכול משמרות לילה..."
                className="w-full px-3 py-2 rounded-lg bg-white/[0.02] border border-white/10 text-[13px] resize-none h-20 focus:outline-none focus:border-white/20"
              />
            ) : worker.standing_constraints ? (
              <p className="text-[13px] p-3 rounded-lg bg-white/[0.02] border border-white/5">
                {worker.standing_constraints}
              </p>
            ) : (
              <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 text-[13px] nocturne-text-muted">
                —
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-wide nocturne-text-muted flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              הערות
            </label>
            {editable ? (
              <textarea
                value={editedNotes}
                onChange={(e) => setEditedNotes(e.target.value)}
                placeholder="הערות נוספות..."
                className="w-full px-3 py-2 rounded-lg bg-white/[0.02] border border-white/10 text-[13px] resize-none h-20 focus:outline-none focus:border-white/20"
              />
            ) : worker.notes ? (
              <p className="text-[13px] p-3 rounded-lg bg-white/[0.02] border border-white/5">
                {worker.notes}
              </p>
            ) : (
              <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 text-[13px] nocturne-text-muted">
                —
              </div>
            )}
          </div>

          {/* Shift history - always read only */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-medium uppercase tracking-wide nocturne-text-muted flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              היסטוריית משמרות
            </h4>
            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5 space-y-2">
              <div className="flex justify-between text-[13px]">
                <span className="nocturne-text-muted">משמרות בשנה האחרונה</span>
                <span className="font-medium">{worker.total_shifts_last_year ?? 0}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="nocturne-text-muted">משמרות סופ״ש</span>
                <span className="font-medium">{worker.weekend_shifts_last_year ?? 0}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="nocturne-text-muted">ימים מאז משמרת אחרונה</span>
                <span className="font-medium">{worker.days_since_last_shift ?? "—"}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="nocturne-text-muted">שובץ ברבעון הנוכחי</span>
                <span className="font-medium">{worker.assigned_this_quarter ? "כן" : "לא"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-white/5 space-y-2">
          {editable && hasChanges && (
            <Button
              className="w-full nocturne-accent-bg hover:opacity-90"
              onClick={handleSave}
              disabled={saving}
            >
              <Save className="h-4 w-4 ml-2" />
              {saving ? "שומר..." : "שמור שינויים"}
            </Button>
          )}
          
          {editable && (
            <div className="flex gap-2">
              {worker.is_archived === 1 ? (
                <Button
                  variant="outline"
                  className="flex-1 text-[12px]"
                  onClick={handleRestore}
                >
                  <RotateCcw className="h-3.5 w-3.5 ml-1.5" />
                  שחזר מארכיון
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="flex-1 text-[12px] text-red-400 hover:text-red-300 hover:border-red-500/30"
                  onClick={handleArchive}
                >
                  <Archive className="h-3.5 w-3.5 ml-1.5" />
                  העבר לארכיון
                </Button>
              )}
            </div>
          )}

          {onAssign && !editable && (
            <Button
              className="w-full nocturne-accent-bg hover:opacity-90"
              onClick={() => onAssign(worker.worker_id)}
            >
              הקצה למשמרת
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (type === "shift" && shift) {
    return (
      <div className="h-full flex flex-col nocturne-surface border-r border-white/5">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div className="flex flex-col">
            <span className="text-[15px] font-medium">{formatDate(shift.date)}</span>
            <div className="flex items-center gap-2">
              <span className="text-[12px] nocturne-text-muted">{shift.shift_type_name}</span>
              {shift.is_weekend === 1 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  סופ״ש
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Primary assignment */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-medium uppercase tracking-wide nocturne-text-muted">משמרת</h4>
            {shift.assigned_worker ? (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <span className="w-8 h-8 rounded-full grid place-items-center text-sm font-medium nocturne-accent-muted nocturne-accent-light">
                  {shift.assigned_worker.name.charAt(0)}
                </span>
                <div className="flex flex-col">
                  <span className="text-[13px] font-medium">{shift.assigned_worker.name}</span>
                  <span className="text-[11px] nocturne-text-muted">{shift.assigned_worker.rank_name}</span>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg border border-dashed border-white/10 text-center">
                <span className="text-[13px] nocturne-text-muted">טרם שובץ</span>
              </div>
            )}
          </div>

          {/* Reserve assignment */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-medium uppercase tracking-wide nocturne-text-muted">רזרבה</h4>
            {shift.reserve_worker ? (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <span className="w-8 h-8 rounded-full grid place-items-center text-sm font-medium nocturne-accent-muted nocturne-accent-light">
                  {shift.reserve_worker.name.charAt(0)}
                </span>
                <div className="flex flex-col">
                  <span className="text-[13px] font-medium">{shift.reserve_worker.name}</span>
                  <span className="text-[11px] nocturne-text-muted">{shift.reserve_worker.rank_name}</span>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg border border-dashed border-white/10 text-center">
                <span className="text-[13px] nocturne-text-muted">טרם שובץ</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
