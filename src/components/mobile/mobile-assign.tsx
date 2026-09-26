"use client";

import { useMemo, useState } from "react";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { DateChip } from "@/components/mobile/date-chip";
import { Avatar } from "@/components/mobile/avatar";
import { ToggleRow } from "@/components/mobile/toggle-row";
import type { AssignmentWarning } from "@/lib/types";

export interface MShift {
  shift_date_id: string;
  date: string;
  shift_type_name: string;
  is_weekend: number;
}
export interface MAssignment {
  assignment_id: string;
  shift_date_id: string;
  worker_name: string;
  is_forced: number;
  role: "shift" | "reserve";
}
export interface MCandidate {
  worker_id: string;
  name: string;
  rank_name: string;
  branch: string | null;
  team: string | null;
  eligibility_priority: number | null;
  is_exempt: number;
  exemption_reason: string | null;
  is_eligible: boolean;
  availability_status: string | null;
  days_since_last_shift: number | null;
  warnings: AssignmentWarning[];
}

interface Props {
  shifts: MShift[];
  assignments: MAssignment[];
  candidates: MCandidate[];
  selectedShiftId: string | null;
  selectedRole: "shift" | "reserve";
  onSelectSlot: (shiftId: string, role: "shift" | "reserve") => void;
  onAssign: (workerId: string) => void;
  onUnassign: (assignmentId: string) => void;
}

const SEV_COLOR: Record<string, string> = {
  red: "#e08a8a",
  orange: "#e0a06a",
  amber: "#dcb182",
  green: "#86c9a4",
};
const SEV_ORDER = ["green", "orange", "amber", "red"];

function severity(c: MCandidate): string {
  if (c.is_exempt === 1 || !c.is_eligible || c.availability_status === "unavailable") return "red";
  return c.warnings.reduce((m, w) => (SEV_ORDER.indexOf(w.severity) > SEV_ORDER.indexOf(m) ? w.severity : m), "green");
}

function note(c: MCandidate): { text: string; color: string } {
  if (c.is_exempt === 1) return { text: `פטור${c.exemption_reason ? " · " + c.exemption_reason : ""}`, color: SEV_COLOR.red };
  if (!c.is_eligible) return { text: "לא כשיר למשמרת זו", color: SEV_COLOR.red };
  if (c.availability_status === "unavailable") return { text: "לא יכול ביום זה", color: SEV_COLOR.red };
  if (c.availability_status === "prefer_not_work") return { text: "מעדיף לא לעבוד ביום זה", color: SEV_COLOR.amber };
  if (c.availability_status === "prefer_work") return { text: "מעדיף לעבוד ביום זה", color: SEV_COLOR.green };
  const w = c.warnings.find((x) => x.severity !== "green");
  if (w) return { text: w.message, color: SEV_COLOR[w.severity] };
  return { text: c.rank_name, color: "#75798c" };
}

const chipCls = (on: boolean) =>
  `text-xs px-3 py-2 rounded-full ${
    on
      ? "shadow-[inset_0_0_0_1px_#9184d9] nocturne-accent-light"
      : "shadow-[inset_0_0_0_1px_#33364a] nocturne-text-muted"
  }`;

function toggleIn(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Chips({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs nocturne-text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o.value} className={chipCls(selected.includes(o.value))} onClick={() => onToggle(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const sevRank: Record<string, number> = { green: 0, orange: 1, amber: 2, red: 3 };

export function MobileAssign({
  shifts,
  assignments,
  candidates,
  selectedShiftId,
  selectedRole,
  onSelectSlot,
  onAssign,
  onUnassign,
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  // shift-list filters
  const [typeF, setTypeF] = useState<string[]>([]);
  const [weekendF, setWeekendF] = useState<string[]>([]);
  const [statusF, setStatusF] = useState<string[]>([]);
  const [shiftFilterSheet, setShiftFilterSheet] = useState(false);

  // candidate filters
  const [candFilters, setCandFilters] = useState(false);
  const [rankF, setRankF] = useState<string[]>([]);
  const [branchF, setBranchF] = useState<string[]>([]);
  const [teamF, setTeamF] = useState<string[]>([]);
  const [showExempt, setShowExempt] = useState(true);
  const [sortKey, setSortKey] = useState<"default" | "name">("default");

  const byShift = useMemo(() => {
    const m = new Map<string, { shift?: MAssignment; reserve?: MAssignment }>();
    for (const a of assignments) {
      const e = m.get(a.shift_date_id) ?? {};
      e[a.role] = a;
      m.set(a.shift_date_id, e);
    }
    return m;
  }, [assignments]);

  const full = shifts.filter((s) => byShift.get(s.shift_date_id)?.shift && byShift.get(s.shift_date_id)?.reserve).length;
  const openSlots = shifts.reduce((n, s) => {
    const e = byShift.get(s.shift_date_id);
    return n + (e?.shift ? 0 : 1) + (e?.reserve ? 0 : 1);
  }, 0);

  const typeOptions = useMemo(
    () => Array.from(new Set(shifts.map((x) => x.shift_type_name))).sort(),
    [shifts]
  );
  const shownShifts = useMemo(() => {
    let l = shifts;
    if (typeF.length) l = l.filter((x) => typeF.includes(x.shift_type_name));
    if (weekendF.length === 1) l = l.filter((x) => (x.is_weekend === 1) === (weekendF[0] === "yes"));
    if (statusF.length) {
      l = l.filter((x) => {
        const e = byShift.get(x.shift_date_id);
        const n = (e?.shift ? 1 : 0) + (e?.reserve ? 1 : 0);
        return statusF.includes(n === 2 ? "full" : n === 0 ? "empty" : "partial");
      });
    }
    return l;
  }, [shifts, typeF, weekendF, statusF, byShift]);
  const shiftFilterCount = typeF.length + (weekendF.length === 1 ? 1 : 0) + statusF.length;

  const selected = shifts.find((s) => s.shift_date_id === selectedShiftId);
  const current = selectedShiftId ? byShift.get(selectedShiftId)?.[selectedRole] : undefined;

  const rankOptions = useMemo(() => Array.from(new Set(candidates.map((c) => c.rank_name))).sort(), [candidates]);
  const branchOptions = useMemo(
    () => Array.from(new Set(candidates.map((c) => c.branch).filter((b): b is string => !!b))).sort(),
    [candidates]
  );
  const teamOptions = useMemo(
    () => Array.from(new Set(candidates.map((c) => c.team).filter((t): t is string => !!t))).sort(),
    [candidates]
  );
  const candFilterCount =
    rankF.length + branchF.length + teamF.length + (showExempt ? 0 : 1) + (sortKey !== "default" ? 1 : 0);

  const list = useMemo(() => {
    let l = candidates;
    const s = q.trim().toLowerCase();
    if (s) l = l.filter((c) => c.name.toLowerCase().includes(s) || c.worker_id.includes(s));
    if (!showExempt) l = l.filter((c) => c.is_exempt === 0);
    if (rankF.length) l = l.filter((c) => rankF.includes(c.rank_name));
    if (branchF.length) l = l.filter((c) => c.branch !== null && branchF.includes(c.branch));
    if (teamF.length) l = l.filter((c) => c.team !== null && teamF.includes(c.team));
    const sev = (c: MCandidate) => c.warnings.reduce((m, w) => Math.max(m, sevRank[w.severity] ?? 0), 0);
    const days = (c: MCandidate) => c.days_since_last_shift ?? -1;
    return [...l].sort((a, b) => {
      const sc = sev(a) - sev(b);
      if (sc) return sc;
      const pa = a.eligibility_priority ?? 999;
      const pb = b.eligibility_priority ?? 999;
      if (pa !== pb) return pa - pb;
      if (sortKey === "name") {
        const n = a.name.localeCompare(b.name, "he");
        if (n) return n;
      }
      return days(b) - days(a);
    });
  }, [candidates, q, showExempt, rankF, branchF, teamF, sortKey]);

  function pick(id: string, role: "shift" | "reserve") {
    onSelectSlot(id, role);
    setQ("");
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-2 -mx-4 -mt-4 h-[calc(100%+1rem)]">
      <div className="px-4 pt-4 pb-1 flex items-center gap-2 text-xs nocturne-text-muted">
        <span className="px-1">
          {full} מתוך {shifts.length} שובצו · {openSlots} פתוחים
          {shiftFilterCount > 0 && ` · מוצגים ${shownShifts.length}`}
        </span>
        <button className={`${chipCls(shiftFilterCount > 0)} mr-auto`} onClick={() => setShiftFilterSheet(true)}>
          סינון{shiftFilterCount > 0 ? ` · ${shiftFilterCount}` : ""}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-4 pb-4 flex flex-col gap-2">
        {shownShifts.map((s) => {
          const e = byShift.get(s.shift_date_id) ?? {};
          const n = (e.shift ? 1 : 0) + (e.reserve ? 1 : 0);
          const status = n === 2 ? ["מלא", "#86c9a4"] : n === 0 ? ["ריק", "#5c6070"] : ["חלקי", "#dcb182"];
          const sel = open && selectedShiftId === s.shift_date_id;
          const slot = (role: "shift" | "reserve", a?: MAssignment) => (
            <button
              onClick={() => pick(s.shift_date_id, role)}
              className={`min-h-11 px-2.5 py-1.5 rounded-[10px] text-right flex flex-col justify-center ${
                sel && selectedRole === role
                  ? "shadow-[inset_0_0_0_1px_#9184d9]"
                  : "shadow-[inset_0_0_0_1px_rgba(233,233,237,.09)]"
              }`}
            >
              <span className="text-[11px] nocturne-text-muted">{role === "shift" ? "משמרת" : "רזרבה"}</span>
              <span
                className={`text-[13px] truncate ${
                  a ? (role === "shift" ? "" : "text-[#b2b6ca]") : "text-[#5c6070]"
                }`}
              >
                {a ? a.worker_name : "לא שובץ"}
                {a?.is_forced === 1 && <span className="nocturne-error text-[10px]"> · כפוי</span>}
              </span>
            </button>
          );
          return (
            <div
              key={s.shift_date_id}
              className={`p-3 rounded-[14px] bg-[#1f2130] flex flex-col gap-2.5 ${
                sel ? "shadow-[inset_0_0_0_1px_#9184d9]" : ""
              }`}
            >
              <div className="flex items-center gap-2.5">
                <DateChip iso={s.date} weekend={s.is_weekend === 1} />
                <span className="text-[15px]">{s.shift_type_name}</span>
                <span className="mr-auto text-xs" style={{ color: status[1] }}>
                  {status[0]}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {slot("shift", e.shift)}
                {slot("reserve", e.reserve)}
              </div>
            </div>
          );
        })}
        {shifts.length === 0 && <div className="py-16 text-center text-sm nocturne-text-muted">אין משמרות ברבעון</div>}
        {shifts.length > 0 && shownShifts.length === 0 && (
          <div className="py-16 text-center text-sm nocturne-text-muted">אין תוצאות לפילטר</div>
        )}
      </div>

      <BottomSheet
        open={shiftFilterSheet}
        onClose={() => setShiftFilterSheet(false)}
        eyebrow="שיבוץ"
        title="סינון משמרות"
        closeLabel="סיום"
      >
        <div className="px-[18px] flex flex-col gap-3.5 overflow-auto">
          <Chips label="סוג משמרת" options={typeOptions.map((t) => ({ value: t, label: t }))} selected={typeF} onToggle={(v) => setTypeF((p) => toggleIn(p, v))} />
          <Chips
            label="ימים"
            options={[
              { value: "yes", label: 'סופ"ש' },
              { value: "no", label: "חול" },
            ]}
            selected={weekendF}
            onToggle={(v) => setWeekendF((p) => toggleIn(p, v))}
          />
          <Chips
            label="סטטוס"
            options={[
              { value: "full", label: "מלא" },
              { value: "partial", label: "חלקי" },
              { value: "empty", label: "ריק" },
            ]}
            selected={statusF}
            onToggle={(v) => setStatusF((p) => toggleIn(p, v))}
          />
          {shiftFilterCount > 0 && (
            <button
              className="min-h-11 rounded-[10px] border nocturne-border text-sm"
              onClick={() => {
                setTypeF([]);
                setWeekendF([]);
                setStatusF([]);
              }}
            >
              איפוס
            </button>
          )}
        </div>
      </BottomSheet>

      <BottomSheet
        open={open && !!selected}
        onClose={() => setOpen(false)}
        eyebrow="מועמדים לסלוט"
        title={
          selected
            ? `${selected.date.slice(8, 10)}/${selected.date.slice(5, 7)} · ${selected.shift_type_name} · ${
                selectedRole === "shift" ? "משמרת" : "רזרבה"
              }`
            : ""
        }
        height="70dvh"
      >
        {current && (
          <div className="mx-[18px] mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#232532]">
            <span className="text-[13px] truncate">משובץ: {current.worker_name}</span>
            <button
              onClick={() => onUnassign(current.assignment_id)}
              className="mr-auto min-h-9 px-3 text-xs rounded-lg border border-[#6b3b40] nocturne-error"
            >
              הסרה
            </button>
          </div>
        )}
        <div className="px-[18px] pb-2.5 flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="חיפוש לפי שם או מספר אישי"
            className="flex-1 min-w-0 min-h-11 rounded-lg px-3 text-sm nocturne-surface border border-white/5 focus:outline-none"
          />
          <button className={chipCls(candFilters || candFilterCount > 0)} onClick={() => setCandFilters((v) => !v)}>
            סינון{candFilterCount > 0 ? ` · ${candFilterCount}` : ""}
          </button>
        </div>
        {candFilters && (
          <div className="mx-[18px] mb-2.5 p-3 rounded-xl bg-[#232532] flex flex-col gap-3 max-h-[38%] overflow-auto flex-none">
            <Chips label="דרגה" options={rankOptions.map((t) => ({ value: t, label: t }))} selected={rankF} onToggle={(v) => setRankF((p) => toggleIn(p, v))} />
            <Chips label="ענף" options={branchOptions.map((t) => ({ value: t, label: t }))} selected={branchF} onToggle={(v) => setBranchF((p) => toggleIn(p, v))} />
            <Chips label="צוות" options={teamOptions.map((t) => ({ value: t, label: t }))} selected={teamF} onToggle={(v) => setTeamF((p) => toggleIn(p, v))} />
            <Chips
              label="מיון"
              options={[
                { value: "default", label: "ברירת מחדל" },
                { value: "name", label: "שם" },
              ]}
              selected={[sortKey]}
              onToggle={(v) => setSortKey(v as "default" | "name")}
            />
            <div className="rounded-lg bg-[#1c1e2c]">
              <ToggleRow label="הצג פטורים" checked={showExempt} onChange={setShowExempt} />
            </div>
            {candFilterCount > 0 && (
              <button
                className="min-h-10 rounded-[10px] border nocturne-border text-sm"
                onClick={() => {
                  setRankF([]);
                  setBranchF([]);
                  setTeamF([]);
                  setShowExempt(true);
                  setSortKey("default");
                }}
              >
                איפוס
              </button>
            )}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto px-3 flex flex-col gap-1.5">
          {list.map((c) => {
            const n = note(c);
            return (
              <div
                key={c.worker_id}
                style={{ borderRightColor: SEV_COLOR[severity(c)] }}
                className="min-h-[60px] px-3 py-2.5 rounded-xl bg-[#232532] border-r-[3px] flex items-center gap-2.5"
              >
                <Avatar name={c.name} />
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm truncate">{c.name}</span>
                  <span className="text-xs truncate" style={{ color: n.color }}>
                    {n.text}
                  </span>
                </span>
                <span className="mr-auto flex flex-none flex-col items-end gap-1">
                  <button
                    onClick={() => {
                      onAssign(c.worker_id);
                      setOpen(false);
                    }}
                    className="min-h-9 px-3.5 rounded-lg text-[12.5px] nocturne-accent-bg text-[#161826] font-medium"
                  >
                    שבץ
                  </button>
                  {c.days_since_last_shift !== null && (
                    <span className="text-[11px] nocturne-text-muted font-sans">{c.days_since_last_shift} ימים</span>
                  )}
                </span>
              </div>
            );
          })}
          {list.length === 0 && <div className="py-8 text-center text-sm nocturne-text-muted">אין מועמדים</div>}
        </div>
      </BottomSheet>
    </div>
  );
}
