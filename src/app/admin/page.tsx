"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSelectedQuarter } from "@/lib/selected-quarter";
import { toast } from "sonner";
import { DateChip } from "@/components/mobile/date-chip";

interface WorkerInfo {
  worker_id: string;
  name: string;
  rank_name: string;
  phone: string | null;
  in_whatsapp_group: number;
  is_exempt: number;
}

interface ShiftTypeProgress {
  shift_type_id: string;
  name: string;
  assigned: number;
  total: number;
}

interface NextOpen {
  shift_date_id: string;
  date: string;
  shift_type_name: string;
  is_weekend: number;
  missingShift: boolean;
}

interface DashboardStats {
  nextOpen: NextOpen[];
  totalWorkers: number;
  exemptWorkers: number;
  totalShifts: number;
  assignedShifts: number;
  openSlots: number;
  weekendOpenSlots: number;
  currentQuarter: string | null;
  inWhatsappGroup: number;
  notInWhatsappGroup: number;
  workersNotInWhatsapp: WorkerInfo[];
  progressByType: ShiftTypeProgress[];
}

// Nocturne stat card component
function StatCard({ 
  label, 
  value, 
  subtext, 
  subtextType = "muted",
  showProgress,
  progressPct 
}: { 
  label: string; 
  value: string | number; 
  subtext?: string;
  subtextType?: "muted" | "warning";
  showProgress?: boolean;
  progressPct?: number;
}) {
  return (
    <div className="rounded-lg flex flex-col gap-1.5 py-3.5 px-4 nocturne-surface">
      <span className="text-[10.5px] tracking-wide nocturne-text-muted">
        {label}
      </span>
      <span className="text-[30px] leading-none font-medium font-sans">
        {value}
      </span>
      {showProgress && progressPct !== undefined && (
        <div className="h-[3px] rounded-sm overflow-hidden mt-0.5 nocturne-accent-muted">
          <div 
            className="h-full rounded-sm transition-all nocturne-accent-bg"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
      {subtext && (
        <span className={`text-[11.5px] ${subtextType === "warning" ? "nocturne-warning" : "nocturne-text-muted"}`}>
          {subtext}
        </span>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalWorkers: 0,
    exemptWorkers: 0,
    totalShifts: 0,
    assignedShifts: 0,
    openSlots: 0,
    weekendOpenSlots: 0,
    currentQuarter: null,
    inWhatsappGroup: 0,
    notInWhatsappGroup: 0,
    workersNotInWhatsapp: [],
    progressByType: [],
    nextOpen: [],
  });

  async function markJoined(workerId: string) {
    const res = await fetch(`/api/workers/${encodeURIComponent(workerId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ in_whatsapp_group: true }),
    });
    if (!res.ok) return toast.error("עדכון נכשל");
    setStats((s) => ({
      ...s,
      inWhatsappGroup: s.inWhatsappGroup + 1,
      notInWhatsappGroup: s.notInWhatsappGroup - 1,
      workersNotInWhatsapp: s.workersNotInWhatsapp.filter((w) => w.worker_id !== workerId),
    }));
  }

  const quarterId = useSelectedQuarter();

  useEffect(() => {
    async function loadStats() {
      const [workersRes, quartersRes, shiftTypesRes] = await Promise.all([
        fetch("/api/workers?include_exempt=true"),
        fetch("/api/quarters"),
        fetch("/api/shift-types"),
      ]);

      const workers: WorkerInfo[] = await workersRes.json();
      const quarters = await quartersRes.json();
      const shiftTypes = await shiftTypesRes.json();

      const currentQuarter =
        quarters.find((q: { quarter_id: string }) => q.quarter_id === quarterId)?.quarter_id ??
        quarters[0]?.quarter_id ??
        null;
      const exemptWorkers = workers.filter((w) => w.is_exempt).length;
      
      // WhatsApp stats
      const inWhatsappGroup = workers.filter((w) => w.in_whatsapp_group === 1).length;
      const notInWhatsappGroup = workers.length - inWhatsappGroup;
      const workersNotInWhatsapp = workers.filter((w) => w.in_whatsapp_group !== 1);

      let shiftDatesCount = 0;
      let assignedShifts = 0;
      let progressByType: ShiftTypeProgress[] = [];
      let nextOpen: NextOpen[] = [];

      if (currentQuarter) {
        const [shiftsRes, assignmentsRes] = await Promise.all([
          fetch(`/api/shifts?quarter_id=${currentQuarter}`),
          fetch(`/api/assignments?quarter_id=${currentQuarter}`),
        ]);

        const shifts: { shift_date_id: string; shift_type_id: string; date: string; shift_type_name: string; is_weekend: number }[] = await shiftsRes.json();
        const assignments: { shift_date_id: string; role: string }[] = await assignmentsRes.json();

        shiftDatesCount = shifts.length;
        assignedShifts = assignments.length;

        // Calculate progress by shift type
        const assignmentsByShift = new Map<string, number>();
        for (const a of assignments) {
          assignmentsByShift.set(a.shift_date_id, (assignmentsByShift.get(a.shift_date_id) || 0) + 1);
        }

        const typeStats = new Map<string, { assigned: number; total: number }>();
        for (const shift of shifts) {
          const existing = typeStats.get(shift.shift_type_id) || { assigned: 0, total: 0 };
          existing.total += 2; // 2 slots per shift date
          existing.assigned += assignmentsByShift.get(shift.shift_date_id) || 0;
          typeStats.set(shift.shift_type_id, existing);
        }

        const hasShift = new Set(assignments.filter((a) => a.role === "shift").map((a) => a.shift_date_id));
        nextOpen = shifts
          .filter((sh) => (assignmentsByShift.get(sh.shift_date_id) || 0) < 2)
          .slice(0, 3)
          .map((sh) => ({
            shift_date_id: sh.shift_date_id,
            date: sh.date,
            shift_type_name: sh.shift_type_name,
            is_weekend: sh.is_weekend,
            missingShift: !hasShift.has(sh.shift_date_id),
          }));

        progressByType = shiftTypes.map((st: { shift_type_id: string; name: string }) => ({
          shift_type_id: st.shift_type_id,
          name: st.name,
          assigned: typeStats.get(st.shift_type_id)?.assigned || 0,
          total: typeStats.get(st.shift_type_id)?.total || 0,
        })).filter((p: ShiftTypeProgress) => p.total > 0);
      }

      // Each shift date has 2 slots: shift + reserve
      const totalSlots = shiftDatesCount * 2;
      const openSlots = Math.max(0, totalSlots - assignedShifts);

      setStats({
        totalWorkers: workers.length,
        exemptWorkers,
        totalShifts: totalSlots,
        assignedShifts,
        openSlots,
        weekendOpenSlots: 0,
        currentQuarter,
        inWhatsappGroup,
        notInWhatsappGroup,
        workersNotInWhatsapp,
        progressByType,
        nextOpen,
      });
    }

    loadStats();
  }, [quarterId]);

  const assignedPct = stats.totalShifts > 0 
    ? Math.round((stats.assignedShifts / stats.totalShifts) * 100) 
    : 0;

  const whatsappPct = stats.totalWorkers > 0 
    ? Math.round((stats.inWhatsappGroup / stats.totalWorkers) * 100) 
    : 0;

  return (
    <div className="flex flex-col gap-[18px] max-w-[1180px]">
      {/* Stat cards grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-3">
        <StatCard 
          label="עובדים פעילים" 
          value={stats.totalWorkers}
          subtext={`${stats.exemptWorkers} פטורים`}
        />
        <StatCard 
          label="סלוטים שובצו" 
          value={stats.assignedShifts}
          showProgress
          progressPct={assignedPct}
        />
        <StatCard 
          label="סלוטים פתוחים" 
          value={stats.openSlots}
          subtext={stats.weekendOpenSlots > 0 ? `${stats.weekendOpenSlots} מהם בסופ״ש` : undefined}
          subtextType="warning"
        />
        <StatCard 
          label="בקבוצת וואטסאפ" 
          value={stats.inWhatsappGroup}
          showProgress
          progressPct={whatsappPct}
          subtext={stats.notInWhatsappGroup > 0 ? `${stats.notInWhatsappGroup} חסרים` : undefined}
          subtextType="warning"
        />
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
        {/* Quick actions section */}
        <section className="rounded-lg flex flex-col gap-3 py-4 px-[18px] nocturne-surface">
          <div className="flex items-baseline gap-2.5">
            <h3 className="text-[15px] font-medium m-0">פעולות מהירות</h3>
          </div>
          
          <Link 
            href="/admin/assign"
            className="flex items-center gap-2.5 py-[7px] px-2 rounded-lg transition-colors hover:bg-white/5"
          >
            <span className="w-[26px] h-[26px] rounded-[7px] grid place-items-center text-[11px] nocturne-accent-muted nocturne-accent-light">
              
            </span>
            <span className="text-[13px]">מעבר למסך שיבוץ</span>
            <span className="text-[11px] mr-auto nocturne-text-tertiary">
              {stats.currentQuarter ? "המשך שיבוץ" : "טרם הועלו תאריכים"}
            </span>
          </Link>
          
          <Link 
            href="/admin/settings?tab=dates"
            className="flex items-center gap-2.5 py-[7px] px-2 rounded-lg transition-colors hover:bg-white/5"
          >
            <span className="w-[26px] h-[26px] rounded-[7px] grid place-items-center text-[11px] nocturne-accent-muted nocturne-accent-light">
              
            </span>
            <span className="text-[13px]">העלאת תאריכי משמרות</span>
            <span className="text-[11px] mr-auto nocturne-text-tertiary">
              ייבוא קובץ לרבעון
            </span>
          </Link>
          
          <Link 
            href="/admin/workers"
            className="flex items-center gap-2.5 py-[7px] px-2 rounded-lg transition-colors hover:bg-white/5"
          >
            <span className="w-[26px] h-[26px] rounded-[7px] grid place-items-center text-[11px] nocturne-accent-muted nocturne-accent-light">
              
            </span>
            <span className="text-[13px]">ניהול עובדים</span>
            <span className="text-[11px] mr-auto nocturne-text-tertiary">
              {stats.totalWorkers} עובדים
            </span>
          </Link>
        </section>

        {/* Progress section */}
        <section className="rounded-lg flex flex-col gap-2.5 py-4 px-[18px] nocturne-surface">
          <div className="flex items-baseline gap-2.5">
            <h3 className="text-[15px] font-medium m-0">התקדמות שיבוץ</h3>
            <span className="text-[11.5px] nocturne-text-muted">
              {stats.currentQuarter || "לא נבחר רבעון"}
            </span>
          </div>
          
          {/* Total progress */}
          <div className="flex items-center gap-3 py-[7px]">
            <span className="w-[120px] flex-none text-[13px]">סה״כ</span>
            <div className="flex-1 h-1.5 rounded-[3px] overflow-hidden nocturne-accent-muted">
              <div 
                className="h-full rounded-[3px] transition-all nocturne-accent-bg"
                style={{ width: `${assignedPct}%` }}
              />
            </div>
            <span className="w-[52px] text-left text-xs nocturne-text-subtle font-sans">
              {stats.assignedShifts}/{stats.totalShifts}
            </span>
          </div>

          {/* Progress by shift type */}
          {stats.progressByType.map((typeProgress) => {
            const pct = typeProgress.total > 0 
              ? Math.round((typeProgress.assigned / typeProgress.total) * 100) 
              : 0;
            return (
              <div key={typeProgress.shift_type_id} className="flex items-center gap-3 py-[7px]">
                <span className="w-[120px] flex-none text-[13px] nocturne-text-muted">{typeProgress.name}</span>
                <div className="flex-1 h-1.5 rounded-[3px] overflow-hidden nocturne-accent-muted">
                  <div 
                    className="h-full rounded-[3px] transition-all nocturne-accent-bg"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-[52px] text-left text-xs nocturne-text-subtle font-sans">
                  {typeProgress.assigned}/{typeProgress.total}
                </span>
              </div>
            );
          })}
          
          {stats.openSlots > 0 && (
            <p className="text-xs m-0 mt-1 nocturne-warning">
              {stats.openSlots} סלוטים טרם שובצו
            </p>
          )}
        </section>
      </div>

      {stats.nextOpen.length > 0 && (
        <section className="md:hidden rounded-[14px] flex flex-col gap-2 py-3.5 px-3.5 bg-[#1f2130]">
          <h3 className="text-[15px] font-medium m-0">הבאות לשיבוץ</h3>
          {stats.nextOpen.map((n) => (
            <Link key={n.shift_date_id} href="/admin/assign" className="min-h-12 flex items-center gap-2.5">
              <DateChip iso={n.date} weekend={n.is_weekend === 1} />
              <span className="flex flex-col">
                <span className="text-sm">{n.shift_type_name}</span>
                <span className={`text-xs ${n.missingShift ? "nocturne-warning" : "nocturne-text-muted"}`}>
                  {n.missingShift ? "משמרת ורזרבה פתוחות" : "רזרבה פתוחה"}
                </span>
              </span>
              <span className="mr-auto text-lg text-[#5c6070]">‹</span>
            </Link>
          ))}
        </section>
      )}

      {/* Workers not in WhatsApp */}
      {stats.workersNotInWhatsapp.length > 0 && (
        <section className="rounded-lg flex flex-col gap-3 py-4 px-[18px] nocturne-surface">
          <div className="flex items-baseline gap-2.5">
            <h3 className="text-[15px] font-medium m-0">עובדים שלא בקבוצת וואטסאפ</h3>
            <span className="text-[11.5px] nocturne-text-muted">
              {stats.workersNotInWhatsapp.length} עובדים
            </span>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {stats.workersNotInWhatsapp.slice(0, 9).map((worker) => (
              <div 
                key={worker.worker_id}
                className="flex items-center gap-2.5 py-2 px-3 rounded-lg bg-white/[0.02]"
              >
                <span className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-medium nocturne-accent-muted nocturne-accent-light">
                  {worker.name.charAt(0)}
                </span>
                <div className="flex flex-col min-w-0">
                  <span className="text-[13px] truncate">{worker.name}</span>
                  <span className="text-[11px] nocturne-text-muted">{worker.rank_name}</span>
                </div>
                {worker.phone && (
                  <span className="hidden md:inline text-[11px] mr-auto nocturne-text-tertiary ltr" dir="ltr">
                    {worker.phone}
                  </span>
                )}
                <button
                  onClick={() => markJoined(worker.worker_id)}
                  className="mr-auto md:mr-0 flex-none min-h-9 px-3 text-xs rounded-lg border nocturne-border"
                >
                  צורף
                </button>
              </div>
            ))}
          </div>
          
          {stats.workersNotInWhatsapp.length > 9 && (
            <Link 
              href="/admin/workers?filter=no-whatsapp"
              className="text-[12px] nocturne-accent-light hover:underline"
            >
              הצג את כל {stats.workersNotInWhatsapp.length} העובדים
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
