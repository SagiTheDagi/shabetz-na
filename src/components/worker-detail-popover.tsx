"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDays, CircleCheck, Pencil, History, Plus, Info } from "lucide-react";

// Structurally compatible with the assign page's WorkerSuggestion.
export interface WorkerDetailData {
  worker_id: string;
  name: string;
  rank_name: string;
  is_exempt: number;
  exemption_reason: string | null;
  receives_shift_allocation: number;
  release_date: string | null;
  branch: string | null;
  team: string | null;
  notes: string | null;
  standing_constraints: string | null;
  days_since_last_shift: number | null;
  assigned_this_quarter: boolean;
}

function formatReleaseDate(d: string) {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

export function WorkerDetailPopover({
  worker,
  onAssign,
  totalShiftsLastYear,
}: {
  worker: WorkerDetailData;
  onAssign?: () => void;
  totalShiftsLastYear?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setShowHistory(false);
      }}
    >
      <PopoverTrigger
        aria-label="פרטי עובד"
        onClick={(e) => e.stopPropagation()}
        className="text-muted-foreground hover:text-foreground w-5 h-5 flex items-center justify-center rounded"
      >
        <Info className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        dir="rtl"
        align="start"
        side="bottom"
        className="w-80"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-semibold">{worker.name}</span>
          <Badge variant="secondary" className="text-xs">
            דרגה: {worker.rank_name}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          מספר אישי: {worker.worker_id}
        </span>

        {/* Status pills */}
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs">
            <CalendarDays className="size-3.5 text-muted-foreground" />
            מקבל הקצאה: {worker.receives_shift_allocation ? "כן" : "לא"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-green-500/40 bg-green-500/10 px-2.5 py-1 text-xs text-green-700 dark:text-green-400">
            <CircleCheck className="size-3.5" />
            סטטוס: פעיל
          </span>
        </div>

        {/* Detail rows */}
        <div className="space-y-1.5 text-sm">
          <div className="flex gap-2">
            <span className="text-muted-foreground shrink-0">פטור:</span>
            {worker.is_exempt ? (
              <span className="text-red-600 dark:text-red-400 font-medium">
                כן{worker.exemption_reason ? ` (סיבה: ${worker.exemption_reason})` : ""}
              </span>
            ) : (
              <span>ללא</span>
            )}
          </div>

          {worker.release_date && (
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">תאריך שחרור:</span>
              <span>{formatReleaseDate(worker.release_date)}</span>
            </div>
          )}

          {worker.branch && (
            <div className="flex gap-2">
              <span className="text-muted-foreground shrink-0">ענף:</span>
              <span>{worker.branch}</span>
            </div>
          )}

          {worker.team && (
            <div className="flex gap-2">
              <span className="text-muted-foreground shrink-0">צוות:</span>
              <span>{worker.team}</span>
            </div>
          )}

          {worker.standing_constraints && (
            <div className="flex gap-2">
              <span className="text-muted-foreground shrink-0">אילוצים קבועים:</span>
              <span>{worker.standing_constraints}</span>
            </div>
          )}

          {worker.notes && (
            <div className="pt-1 border-t">
              <span className="text-muted-foreground">הערות: </span>
              <span>{worker.notes}</span>
            </div>
          )}
        </div>

        {/* History summary (toggle) */}
        {showHistory && (
          <div className="rounded-lg border bg-muted/40 p-2.5 space-y-1.5 text-sm">
            <p className="font-medium text-xs text-muted-foreground">היסטוריית משמרות</p>
            <div className="flex justify-between">
              <span className="text-muted-foreground">משמרות בשנה האחרונה</span>
              <span className="font-medium">{totalShiftsLastYear ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">ימים מאז המשמרת האחרונה</span>
              <span className="font-medium">{worker.days_since_last_shift ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">שובץ ברבעון הנוכחי</span>
              <span className="font-medium">{worker.assigned_this_quarter ? "כן" : "לא"}</span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t">
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => router.push("/admin/settings?tab=workers")}
            >
              <Pencil className="size-3.5" />
              ערוך פרופיל
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setShowHistory((v) => !v)}
            >
              <History className="size-3.5" />
              {showHistory ? "הסתר" : "היסטוריה"}
            </Button>
          </div>
          {onAssign && (
            <Button
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => {
                onAssign();
                setOpen(false);
              }}
            >
              <Plus className="size-3.5" />
              הקצה
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
