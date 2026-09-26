"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { DateChip } from "@/components/mobile/date-chip";
import {
  isWeekendDate,
  SHIFT_DATE_ISSUE_MESSAGES,
  validateShiftDate,
} from "@/lib/shift-date-validation";
import { useSelectedQuarter } from "@/lib/selected-quarter";
import type { Quarter, ShiftType } from "@/lib/types";

interface Row {
  shift_date_id: string;
  date: string;
  shift_type_id: string;
  shift_type_name: string;
  is_weekend: number;
}
interface Assignment {
  shift_date_id: string;
}

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

interface Draft {
  id: string | null;
  date: string;
  shift_type_id: string;
}

export function MobileShiftDates() {
  const [types, setTypes] = useState<ShiftType[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [staffed, setStaffed] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (q: string) => {
    const [sr, ar] = await Promise.all([
      fetch(`/api/shifts?quarter_id=${q}`).then((r) => r.json()),
      fetch(`/api/assignments?quarter_id=${q}`).then((r) => r.json()),
    ]);
    setRows(sr);
    const m: Record<string, number> = {};
    for (const a of ar as Assignment[]) m[a.shift_date_id] = (m[a.shift_date_id] ?? 0) + 1;
    setStaffed(m);
  }, []);

  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const savedQuarter = useSelectedQuarter();
  const quarter = quarters.find((x) => x.quarter_id === savedQuarter) ?? quarters[0] ?? null;
  const quarterId = quarter?.quarter_id;

  useEffect(() => {
    Promise.all([fetch("/api/quarters").then((r) => r.json()), fetch("/api/shift-types").then((r) => r.json())]).then(
      ([qs, ts]: [Quarter[], ShiftType[]]) => {
        setTypes(ts);
        setQuarters(qs);
      }
    );
  }, []);

  useEffect(() => {
    // load() only sets state after awaited fetches
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (quarterId) load(quarterId);
  }, [quarterId, load]);

  const issue = useMemo(() => {
    if (!draft || !quarter) return null;
    return validateShiftDate(draft, quarter, rows, draft.id);
  }, [draft, quarter, rows]);

  const editing = draft?.id ? rows.find((r) => r.shift_date_id === draft.id) : null;
  const editingStaff = editing ? staffed[editing.shift_date_id] ?? 0 : 0;

  async function save() {
    if (!draft || !quarter || issue) return;
    setBusy(true);
    const res = draft.id
      ? await fetch(`/api/shifts/${draft.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: draft.date, shift_type_id: draft.shift_type_id }),
        })
      : await fetch("/api/shifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quarter_id: quarter.quarter_id,
            dates: [{ date: draft.date, shift_type_id: draft.shift_type_id, is_weekend: isWeekendDate(draft.date) }],
          }),
        });
    setBusy(false);
    if (!res.ok) return toast.error((await res.json().catch(() => null))?.error ?? "שמירה נכשלה");
    toast.success("נשמר");
    setDraft(null);
    load(quarter.quarter_id);
  }

  async function remove() {
    if (!draft?.id || !quarter) return;
    if (editingStaff > 0 && !window.confirm(`למשמרת זו יש ${editingStaff} שיבוצים שיימחקו. למחוק?`)) return;
    setBusy(true);
    const res = await fetch(`/api/shifts/${draft.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return toast.error("מחיקה נכשלה");
    toast.success("נמחק");
    setDraft(null);
    load(quarter.quarter_id);
  }

  function startAdd() {
    if (!quarter || types.length === 0) return;
    setDraft({ id: null, date: quarter.start_date, shift_type_id: types[0].shift_type_id });
  }

  if (!quarter) return <div className="py-16 text-center text-sm nocturne-text-muted">אין רבעון. יש ליצור רבעון במחשב.</div>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs nocturne-text-muted">
            {quarter.quarter_id} · {rows.length} משמרות
          </span>
          <h2 className="text-2xl font-medium m-0">תאריכי משמרות</h2>
        </div>
        <button onClick={startAdd} className="mr-auto min-h-10 px-4 rounded-lg text-[13px] nocturne-accent-bg text-[#161826] font-medium">
          הוספה
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((r) => {
          const n = staffed[r.shift_date_id] ?? 0;
          const wd = new Date(r.date + "T12:00:00").getDay();
          return (
            <button
              key={r.shift_date_id}
              onClick={() => setDraft({ id: r.shift_date_id, date: r.date, shift_type_id: r.shift_type_id })}
              className="min-h-[60px] flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#1f2130] text-right"
            >
              <DateChip iso={r.date} weekend={r.is_weekend === 1} />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm">{r.shift_type_name}</span>
                <span className="text-xs nocturne-text-muted">
                  יום {DAYS[wd]}
                  {r.is_weekend === 1 ? " · סופ״ש" : ""}
                </span>
              </span>
              <span className="mr-auto text-xs" style={{ color: n === 2 ? "#86c9a4" : n === 0 ? "#5c6070" : "#dcb182" }}>
                {n === 2 ? "מלא" : n === 0 ? "ריק" : "חלקי"}
              </span>
            </button>
          );
        })}
        {rows.length === 0 && <div className="py-12 text-center text-sm nocturne-text-muted">אין תאריכים. הוספה או ייבוא קובץ במחשב.</div>}
      </div>

      <BottomSheet
        open={!!draft}
        onClose={() => setDraft(null)}
        eyebrow="ישות · תאריך משמרת"
        title={draft?.id ? "עריכת משמרת" : "משמרת חדשה"}
        closeLabel="ביטול"
      >
        {draft && (
          <div className="px-[18px] flex flex-col gap-3.5">
            <label className="flex flex-col gap-1">
              <span className="text-xs nocturne-text-muted">תאריך</span>
              <input
                type="date"
                dir="ltr"
                value={draft.date}
                min={quarter.start_date}
                max={quarter.end_date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                className="min-h-11 rounded-lg px-3 text-[15px] font-sans nocturne-surface border border-white/5"
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-xs nocturne-text-muted">סוג משמרת</span>
              <div className="grid grid-cols-2 gap-2">
                {types.map((t) => (
                  <button
                    key={t.shift_type_id}
                    onClick={() => setDraft({ ...draft, shift_type_id: t.shift_type_id })}
                    className={`min-h-11 px-3 py-2 rounded-[10px] text-[13px] text-right ${
                      draft.shift_type_id === t.shift_type_id
                        ? "shadow-[inset_0_0_0_1px_#9184d9] nocturne-accent-light"
                        : "shadow-[inset_0_0_0_1px_#33364a] nocturne-text-muted"
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
            <span className="text-[12.5px]" style={{ color: issue ? "#e08a8a" : "#9397ab" }}>
              {issue
                ? SHIFT_DATE_ISSUE_MESSAGES[issue]
                : editingStaff > 0
                ? `למשמרת ${editingStaff} שיבוצים — השינוי לא יסיר אותם`
                : isWeekendDate(draft.date)
                ? "תאריך סופ״ש"
                : " "}
            </span>
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={!!issue || busy}
                className="flex-1 min-h-12 rounded-[10px] text-[15px] nocturne-accent-bg text-[#161826] font-medium disabled:opacity-40"
              >
                {draft.id ? "שמירה" : "הוספה"}
              </button>
              {draft.id && (
                <button onClick={remove} disabled={busy} className="min-h-12 px-4 rounded-[10px] border border-[#6b3b40] text-sm nocturne-error">
                  מחיקה
                </button>
              )}
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
