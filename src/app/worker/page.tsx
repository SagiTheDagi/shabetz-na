"use client";

import { useState, useEffect, useCallback } from "react";
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
  { bgClass: string; ringClass: string; label: string; colorClass: string; dotClass: string }
> = {
  default: { bgClass: "bg-status-default-bg", ringClass: "shadow-[inset_0_0_0_1px_rgba(233,233,237,0.09)]", label: "ללא העדפה", colorClass: "text-status-default-text", dotClass: "bg-status-default-text" },
  unavailable: { bgClass: "bg-status-unavailable-bg", ringClass: "ring-1 ring-inset ring-error", label: "לא זמין", colorClass: "text-error", dotClass: "bg-error" },
  prefer_work: { bgClass: "bg-status-prefer-work-bg", ringClass: "ring-1 ring-inset ring-success", label: "מעדיף לעבוד", colorClass: "text-success", dotClass: "bg-success" },
  prefer_not_work: { bgClass: "bg-status-prefer-not-work-bg", ringClass: "ring-1 ring-inset ring-warning", label: "מעדיף לא", colorClass: "text-warning", dotClass: "bg-warning" },
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

  const markedCount = availability.size;
  const totalCount = shiftDates.length;

  if (quarters.length === 0) {
    return (
      <div className="text-center py-12 nocturne-text-muted">
        <p>אין רבעון פעיל כרגע</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Quarter selector */}
      {quarters.length > 1 && (
        <div className="flex gap-2">
          {quarters.map((q) => (
            <button
              key={q.quarter_id}
              onClick={() => setSelectedQuarter(q.quarter_id)}
              className={`h-8 px-3 text-xs rounded-lg transition-colors border ${
                selectedQuarter === q.quarter_id 
                  ? "bg-primary border-primary text-primary-foreground" 
                  : "bg-transparent nocturne-border nocturne-text"
              }`}
            >
              {q.quarter_id}
            </button>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm">
        {Object.entries(STATUS_CONFIG)
          .filter(([key]) => key !== "default")
          .map(([key, config]) => (
            <span key={key} className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-sm ${config.dotClass}`} />
              <span className="nocturne-text-subtle">{config.label}</span>
            </span>
          ))}
      </div>
      
      <p className="text-xs nocturne-text-muted">
        לחץ על תאריך כדי לשנות סטטוס · {markedCount} ימים סומנו מתוך {totalCount}
      </p>

      {/* Calendar by month */}
      {Array.from(byMonth.entries()).map(([monthKey, dates]) => {
        const [year, month] = monthKey.split("-");
        return (
          <section 
            key={monthKey}
            className="rounded-lg py-4 px-[18px] nocturne-surface"
          >
            <h3 className="text-base font-medium mb-3">
              {hebrewMonths[month]} {year}
            </h3>
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
                    className={`p-3 rounded-lg text-center transition-all cursor-pointer hover:opacity-80 ${config.bgClass} ${config.ringClass}`}
                  >
                    <div className="text-[17px] font-medium leading-none font-sans">
                      {dayNum}
                    </div>
                    <div className="text-[10px] mt-1 nocturne-text-tertiary">
                      יום {dayName}
                    </div>
                    <div className="text-[10.5px] mt-1.5 py-0.5 px-2 rounded inline-block bg-muted nocturne-text-subtle">
                      {sd.shift_type_name}
                    </div>
                    {sd.is_weekend && (
                      <div className="text-[10.5px] mt-1 py-0.5 px-2 rounded inline-block nocturne-accent-badge">
                        סופ״ש
                      </div>
                    )}
                    {status !== "default" && (
                      <div className={`text-[10px] mt-1.5 font-medium ${config.colorClass}`}>
                        {config.label}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Save button */}
      {shiftDates.length > 0 && (
        <div className="sticky bottom-4">
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className={`w-full h-11 text-sm font-medium rounded-lg transition-colors disabled:opacity-45 disabled:cursor-not-allowed border ${
              dirty 
                ? "bg-transparent border-primary text-primary hover:bg-primary/10" 
                : "bg-status-prefer-work-bg border-success text-success"
            }`}
          >
            {saving ? "שומר..." : dirty ? "שמירת שינויים" : "נשמר"}
          </button>
        </div>
      )}
    </div>
  );
}
