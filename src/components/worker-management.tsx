"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { WorkerWithRank } from "@/lib/types";

interface EditState {
  is_exempt: boolean;
  exemption_reason: string;
  receives_shift_allocation: boolean;
  standing_constraints: string;
  notes: string;
  branch: string;
  team: string;
}

function toEditState(w: WorkerWithRank): EditState {
  return {
    is_exempt: !!w.is_exempt,
    exemption_reason: w.exemption_reason ?? "",
    receives_shift_allocation: w.receives_shift_allocation !== 0,
    standing_constraints: w.standing_constraints ?? "",
    notes: w.notes ?? "",
    branch: w.branch ?? "",
    team: w.team ?? "",
  };
}

const TODAY = new Date().toISOString().slice(0, 10);

export function WorkerManagement() {
  const [workers, setWorkers] = useState<WorkerWithRank[]>([]);
  const [archivedWorkers, setArchivedWorkers] = useState<WorkerWithRank[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<WorkerWithRank | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    runAutoArchive().then(loadWorkers);
  }, []);

  async function runAutoArchive() {
    const res = await fetch("/api/workers/auto-archive", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      if (data.archived > 0) {
        toast.info(`${data.archived} עובדים הועברו לארכיון אוטומטית (תאריך שחרור עבר)`);
      }
    }
  }

  async function loadWorkers() {
    const [activeRes, archivedRes] = await Promise.all([
      fetch("/api/workers?include_exempt=true"),
      fetch("/api/workers?include_exempt=true&include_archived=true"),
    ]);
    const activeData: WorkerWithRank[] = await activeRes.json();
    const allData: WorkerWithRank[] = await archivedRes.json();
    setWorkers(activeData);
    setArchivedWorkers(allData.filter((w) => w.is_archived));
  }

  function selectWorker(w: WorkerWithRank) {
    setSelected(w);
    setEdit(toEditState(w));
  }

  async function handleSave() {
    if (!selected || !edit) return;

    if (edit.is_exempt && !edit.exemption_reason.trim()) {
      toast.error("יש להזין סיבת פטור");
      return;
    }

    setSaving(true);
    const res = await fetch(`/api/workers/${selected.worker_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        is_exempt: edit.is_exempt,
        exemption_reason: edit.exemption_reason.trim() || null,
        receives_shift_allocation: edit.receives_shift_allocation,
        standing_constraints: edit.standing_constraints.trim() || null,
        notes: edit.notes.trim() || null,
        branch: edit.branch.trim() || null,
        team: edit.team.trim() || null,
      }),
    });

    if (res.ok) {
      toast.success("עובד עודכן");
      await loadWorkers();
      setSelected((prev) => {
        if (!prev) return null;
        const updated = workers.find((w) => w.worker_id === prev.worker_id);
        return updated ?? prev;
      });
    } else {
      const data = await res.json();
      toast.error(data.error ?? "שגיאה בשמירה");
    }
    setSaving(false);
  }

  function handleCancel() {
    if (selected) setEdit(toEditState(selected));
  }

  async function handleArchive() {
    if (!selected) return;
    if (!confirm(`להעביר את ${selected.name} לארכיון?`)) return;

    setArchiving(true);
    const res = await fetch(`/api/workers/${selected.worker_id}`, { method: "DELETE" });

    if (res.ok) {
      toast.success("העובד הועבר לארכיון");
      setSelected(null);
      setEdit(null);
      await loadWorkers();
    } else {
      const data = await res.json();
      toast.error(data.error ?? "שגיאה בהעברה לארכיון");
    }
    setArchiving(false);
  }

  async function handleRestore(w: WorkerWithRank) {
    const res = await fetch(`/api/workers/${w.worker_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_archived: false }),
    });

    if (res.ok) {
      toast.success(`${w.name} שוחזר`);
      await loadWorkers();
    } else {
      const data = await res.json();
      toast.error(data.error ?? "שגיאה בשחזור");
    }
  }

  const filtered = workers.filter(
    (w) =>
      w.name.includes(search) ||
      w.worker_id.includes(search) ||
      w.rank_name.includes(search) ||
      (w.branch ?? "").includes(search) ||
      (w.team ?? "").includes(search)
  );

  const isDirty =
    edit &&
    selected &&
    JSON.stringify(edit) !== JSON.stringify(toEditState(selected));

  return (
    <div className="space-y-6">
      <div className="flex gap-4 min-h-125">
        {/* Worker list */}
        <div className="w-72 shrink-0 flex flex-col gap-2">
          <Input
            placeholder="חיפוש לפי שם / מספר / דרגה..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm"
          />
          <div className="border rounded-lg overflow-auto flex-1 max-h-130">
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground p-3 text-center">אין תוצאות</p>
            )}
            {filtered.map((w) => (
              <button
                key={w.worker_id}
                onClick={() => selectWorker(w)}
                className={`w-full text-right px-3 py-2 text-sm border-b last:border-b-0 transition-colors hover:bg-muted/50 ${
                  selected?.worker_id === w.worker_id ? "bg-muted" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-medium truncate">{w.name}</span>
                  {!!w.is_exempt && (
                    <Badge variant="destructive" className="text-xs shrink-0">פטור</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground flex gap-2">
                  <span>{w.rank_name}</span>
                  <span className="font-mono">{w.worker_id}</span>
                  {w.branch && <span>{w.branch}</span>}
                  {w.team && <span>{w.team}</span>}
                </div>
                {w.notes && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 opacity-70">
                    {w.notes}
                  </p>
                )}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center">{filtered.length} עובדים</p>
        </div>

        {/* Edit panel */}
        {selected && edit ? (
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            <div className="flex items-baseline gap-3">
              <h3 className="font-semibold text-base">{selected.name}</h3>
              <span className="text-sm text-muted-foreground font-mono">{selected.worker_id}</span>
              <span className="text-sm text-muted-foreground">{selected.rank_name}</span>
            </div>

            {/* Exemption section */}
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="is_exempt"
                  checked={edit.is_exempt}
                  onChange={(e) => setEdit({ ...edit, is_exempt: e.target.checked, exemption_reason: e.target.checked ? edit.exemption_reason : "" })}
                  className="cursor-pointer w-4 h-4"
                />
                <Label htmlFor="is_exempt" className="cursor-pointer font-medium">
                  פטור ממשמרות
                </Label>
                {edit.is_exempt && (
                  <span className="text-xs text-destructive">* שיובא ברשימת השיבוץ עם אזהרה אדומה</span>
                )}
              </div>

              {edit.is_exempt && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="exemption_reason" className="text-sm">
                      סיבת פטור <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="exemption_reason"
                      value={edit.exemption_reason}
                      onChange={(e) => setEdit({ ...edit, exemption_reason: e.target.value })}
                      placeholder='למשל: "בהשלמה", "עבר יחידה", "פטור רפואי"'
                      className="text-sm"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="receives_allocation"
                      checked={edit.receives_shift_allocation}
                      onChange={(e) => setEdit({ ...edit, receives_shift_allocation: e.target.checked })}
                      className="cursor-pointer w-4 h-4"
                    />
                    <Label htmlFor="receives_allocation" className="cursor-pointer text-sm">
                      מקבל הקצאת משמרת למרות הפטור
                    </Label>
                  </div>
                </>
              )}
            </div>

            {/* Branch and team */}
            <div className="flex gap-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor="branch" className="text-sm font-medium">ענף</Label>
                <Input
                  id="branch"
                  value={edit.branch}
                  onChange={(e) => setEdit({ ...edit, branch: e.target.value })}
                  placeholder="שם הענף..."
                  className="text-sm"
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="team" className="text-sm font-medium">צוות</Label>
                <Input
                  id="team"
                  value={edit.team}
                  onChange={(e) => setEdit({ ...edit, team: e.target.value })}
                  placeholder="שם הצוות..."
                  className="text-sm"
                />
              </div>
            </div>

            {/* Standing constraints */}
            <div className="space-y-1">
              <Label htmlFor="standing_constraints" className="text-sm font-medium">
                אילוצים קבועים
              </Label>
              <p className="text-xs text-muted-foreground">אילוצים שחוזרים בכל רבעון — למשל ימי לימודים</p>
              <Textarea
                id="standing_constraints"
                value={edit.standing_constraints}
                onChange={(e) => setEdit({ ...edit, standing_constraints: e.target.value })}
                placeholder="למשל: ראשון שלישי שישי — ימי לימודים"
                rows={3}
                className="text-sm resize-none"
              />
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <Label htmlFor="notes" className="text-sm font-medium">
                הערות
              </Label>
              <p className="text-xs text-muted-foreground">אילוצי רבעון נוכחי ומידע רלוונטי — גלוי גם במסך השיבוץ</p>
              <Textarea
                id="notes"
                value={edit.notes}
                onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                placeholder="הערות חופשיות על העובד..."
                rows={5}
                className="text-sm resize-none"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving || !isDirty}>
                  {saving ? "שומר..." : "שמור שינויים"}
                </Button>
                {isDirty && (
                  <Button variant="outline" onClick={handleCancel} disabled={saving}>
                    ביטול
                  </Button>
                )}
              </div>
              <Button
                variant="outline"
                onClick={handleArchive}
                disabled={archiving || saving}
                className="text-muted-foreground hover:text-destructive hover:border-destructive"
              >
                {archiving ? "מעביר לארכיון..." : "העבר לארכיון"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            בחר עובד מהרשימה לעריכה
          </div>
        )}
      </div>

      {/* Released workers — past release_date but still active (grace period) */}
      {(() => {
        const released = workers.filter((w) => w.release_date && w.release_date < TODAY);
        if (released.length === 0) return null;
        return (
          <div className="border border-amber-500/40 rounded-lg bg-amber-500/5">
            <div className="px-4 py-3 flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  עובדים ששוחררו ({released.length})
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  עברו את תאריך תום שירותם — יועברו לארכיון אוטומטית לאחר רבעון
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                onClick={async () => {
                  for (const w of released) {
                    await fetch(`/api/workers/${w.worker_id}`, { method: "DELETE" });
                  }
                  toast.success(`${released.length} עובדים הועברו לארכיון`);
                  await loadWorkers();
                  if (released.some((w) => w.worker_id === selected?.worker_id)) {
                    setSelected(null);
                    setEdit(null);
                  }
                }}
              >
                העבר את כולם לארכיון
              </Button>
            </div>
            <div className="border-t border-amber-500/20 divide-y divide-amber-500/10">
              {released.map((w) => (
                <div key={w.worker_id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div>
                    <span className="font-medium">{w.name}</span>
                    <span className="text-muted-foreground text-xs mr-2">{w.rank_name}</span>
                    <span className="text-muted-foreground text-xs font-mono mr-2">{w.worker_id}</span>
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      שוחרר {w.release_date}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={async () => {
                      await fetch(`/api/workers/${w.worker_id}`, { method: "DELETE" });
                      toast.success(`${w.name} הועבר לארכיון`);
                      await loadWorkers();
                      if (selected?.worker_id === w.worker_id) { setSelected(null); setEdit(null); }
                    }}
                  >
                    העבר לארכיון
                  </Button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Archived workers section */}
      {archivedWorkers.length > 0 && (
        <div className="border rounded-lg">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            <span className="text-muted-foreground">
              ארכיון עובדים ({archivedWorkers.length})
            </span>
            <span className="text-muted-foreground text-xs">{showArchived ? "▲" : "▼"}</span>
          </button>
          {showArchived && (
            <div className="border-t divide-y">
              {archivedWorkers.map((w) => (
                <div
                  key={w.worker_id}
                  className="flex items-center justify-between px-4 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium">{w.name}</span>
                    <span className="text-muted-foreground text-xs mr-2">{w.rank_name}</span>
                    <span className="text-muted-foreground text-xs font-mono">{w.worker_id}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestore(w)}
                    className="text-xs"
                  >
                    שחזר
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
