"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { ShiftDateWithType, WorkerAvailability, Quarter, AvailabilityStatus } from "@/lib/types";

const STATUS_CYCLE: (AvailabilityStatus | "default")[] = [
  "default",
  "unavailable",
  "prefer_work",
  "prefer_not_work",
];

const STATUS_CONFIG: Record<
  string,
  { bg: string; label: string; emoji: string }
> = {
  default: { bg: "bg-card", label: "ללא העדפה", emoji: "" },
  unavailable: { bg: "bg-red-100 dark:bg-red-950 border-red-300 dark:border-red-800", label: "לא יכול", emoji: "🔴" },
  prefer_work: { bg: "bg-green-100 dark:bg-green-950 border-green-300 dark:border-green-800", label: "מעדיף לעבוד", emoji: "🟢" },
  prefer_not_work: { bg: "bg-orange-100 dark:bg-orange-950 border-orange-300 dark:border-orange-800", label: "מעדיף לא", emoji: "🟠" },
};

export default function WorkerPage() {
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [selectedQuarter, setSelectedQuarter] = useState<string>("");
  const [shiftDates, setShiftDates] = useState<ShiftDateWithType[]>([]);
  const [availability, setAvailability] = useState<Map<string, AvailabilityStatus>>(new Map());
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const loadQuarters = useCallback(async () => {
    const res = await fetch("/api/quarters");
    const data: Quarter[] = await res.json();
    setQuarters(data);
    if (data.length > 0) {
      setSelectedQuarter(data[0].quarter_id);
    }
  }, []);

  useEffect(() => {
    loadQuarters();
  }, [loadQuarters]);

  useEffect(() => {
    if (!selectedQuarter) return;

    async function loadData() {
      const [shiftsRes, availRes] = await Promise.all([
        fetch(`/api/shifts?quarter_id=${selectedQuarter}`),
        fetch(`/api/availability?quarter_id=${selectedQuarter}`),
      ]);

      const shifts: ShiftDateWithType[] = await shiftsRes.json();
      const avail: WorkerAvailability[] = await availRes.json();

      setShiftDates(shifts);
      const map = new Map<string, AvailabilityStatus>();
      for (const a of avail) {
        map.set(a.date, a.status);
      }
      setAvailability(map);
      setDirty(false);
    }

    loadData();
  }, [selectedQuarter]);

  function toggleDate(date: string) {
    const current = availability.get(date) || "default";
    const currentIdx = STATUS_CYCLE.indexOf(current as AvailabilityStatus | "default");
    const nextIdx = (currentIdx + 1) % STATUS_CYCLE.length;
    const next = STATUS_CYCLE[nextIdx];

    const newMap = new Map(availability);
    if (next === "default") {
      newMap.delete(date);
    } else {
      newMap.set(date, next as AvailabilityStatus);
    }
    setAvailability(newMap);
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    const entries = Array.from(availability.entries()).map(([date, status]) => ({
      date,
      status,
    }));

    const res = await fetch("/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quarter_id: selectedQuarter,
        entries,
      }),
    });

    if (res.ok) {
      toast.success("הזמינות נשמרה");
      setDirty(false);
    } else {
      toast.error("שגיאה בשמירה");
    }
    setSaving(false);
  }

  // Group shift dates by month
  const byMonth = new Map<string, ShiftDateWithType[]>();
  for (const sd of shiftDates) {
    const monthKey = sd.date.substring(0, 7); // YYYY-MM
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
    byMonth.get(monthKey)!.push(sd);
  }

  const hebrewMonths: Record<string, string> = {
    "01": "ינואר", "02": "פברואר", "03": "מרץ", "04": "אפריל",
    "05": "מאי", "06": "יוני", "07": "יולי", "08": "אוגוסט",
    "09": "ספטמבר", "10": "אוקטובר", "11": "נובמבר", "12": "דצמבר",
  };

  const hebrewDays = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

  if (quarters.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>אין רבעון פעיל כרגע</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quarter selector */}
      {quarters.length > 1 && (
        <div className="flex gap-2">
          {quarters.map((q) => (
            <Button
              key={q.quarter_id}
              variant={selectedQuarter === q.quarter_id ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedQuarter(q.quarter_id)}
            >
              {q.quarter_id}
            </Button>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-sm">
        {Object.entries(STATUS_CONFIG)
          .filter(([key]) => key !== "default")
          .map(([key, config]) => (
            <span key={key} className="flex items-center gap-1">
              <span>{config.emoji}</span>
              <span>{config.label}</span>
            </span>
          ))}
      </div>
      <p className="text-xs text-muted-foreground">לחץ על תאריך כדי לשנות סטטוס</p>

      {/* Calendar by month */}
      {Array.from(byMonth.entries()).map(([monthKey, dates]) => {
        const [year, month] = monthKey.split("-");
        return (
          <Card key={monthKey}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {hebrewMonths[month]} {year}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {dates.map((sd) => {
                  const status = availability.get(sd.date) || "default";
                  const config = STATUS_CONFIG[status];
                  const dateObj = new Date(sd.date + "T00:00:00");
                  const dayNum = dateObj.getDate();
                  const dayName = hebrewDays[dateObj.getDay()];

                  return (
                    <button
                      key={sd.shift_date_id}
                      onClick={() => toggleDate(sd.date)}
                      className={`p-3 rounded-lg border text-center transition-colors ${config.bg} hover:opacity-80`}
                    >
                      <div className="text-lg font-bold">{dayNum}</div>
                      <div className="text-xs text-muted-foreground">יום {dayName}</div>
                      <Badge variant="secondary" className="mt-1 text-xs">
                        {sd.shift_type_name}
                      </Badge>
                      {sd.is_weekend ? (
                        <div className="text-xs text-slate-400 mt-1">סופ&quot;ש</div>
                      ) : null}
                      {config.emoji && (
                        <div className="mt-1">{config.emoji}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Save button */}
      {shiftDates.length > 0 && (
        <div className="sticky bottom-4">
          <Button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="w-full"
            size="lg"
          >
            {saving ? "שומר..." : dirty ? "💾 שמירת שינויים" : "✓ נשמר"}
          </Button>
        </div>
      )}
    </div>
  );
}
