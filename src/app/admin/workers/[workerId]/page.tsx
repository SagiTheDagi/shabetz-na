"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/mobile/avatar";
import { ToggleRow } from "@/components/mobile/toggle-row";
import type { Rank, Worker } from "@/lib/types";

type WorkerRow = Worker & { rank_name: string };

interface Form {
  name: string;
  rank_id: string;
  phone: string;
  branch: string;
  team: string;
  release_date: string;
  receives_shift_allocation: boolean;
  is_exempt: boolean;
  exemption_reason: string;
  is_admin: boolean;
  standing_constraints: string;
  notes: string;
  in_whatsapp_group: boolean;
  is_archived: boolean;
  password: string;
}

function toForm(w: WorkerRow): Form {
  return {
    name: w.name,
    rank_id: w.rank_id,
    phone: w.phone ?? "",
    branch: w.branch ?? "",
    team: w.team ?? "",
    release_date: w.release_date ?? "",
    receives_shift_allocation: w.receives_shift_allocation === 1,
    is_exempt: w.is_exempt === 1,
    exemption_reason: w.exemption_reason ?? "",
    is_admin: w.is_admin === 1,
    standing_constraints: w.standing_constraints ?? "",
    notes: w.notes ?? "",
    in_whatsapp_group: w.in_whatsapp_group === 1,
    is_archived: w.is_archived === 1,
    password: "",
  };
}

function releaseHint(iso: string): string | null {
  if (!iso) return null;
  const days = Math.round((new Date(iso + "T12:00:00").getTime() - Date.now()) / 86400000);
  const [y, m, d] = iso.split("-");
  const label = `${d}/${m}/${y}`;
  if (days < 0) return `שוחרר · לא ישובץ אחרי ${label}`;
  if (days < 60) return `שחרור בעוד ${days} ימים · לא ישובץ אחרי ${label}`;
  return `שחרור בעוד כ-${Math.round(days / 30)} חודשים · לא ישובץ אחרי ${label}`;
}

function fmtTs(ts: string) {
  const d = new Date(ts.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? ts : d.toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

const inputCls =
  "w-full min-h-11 rounded-lg px-3 text-[15px] nocturne-surface border border-white/5 focus:outline-none focus:border-white/15";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs nocturne-text-muted">{label}</span>
      {children}
    </label>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] tracking-[.12em] nocturne-text-muted pt-1">{children}</span>;
}

export default function WorkerDetailPage() {
  const { workerId } = useParams<{ workerId: string }>();
  const router = useRouter();
  const [worker, setWorker] = useState<WorkerRow | null>(null);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [stats, setStats] = useState<{ shifts: number; weekends: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const id = decodeURIComponent(workerId);
    Promise.all([
      fetch("/api/workers?include_exempt=true&include_archived=true").then((r) => r.json()),
      fetch("/api/ranks").then((r) => r.json()),
    ]).then(([ws, rs]: [WorkerRow[], Rank[]]) => {
      const w = ws.find((x) => x.worker_id === id);
      if (!w) return setMissing(true);
      setWorker(w);
      setForm(toForm(w));
      setRanks(rs);
    });
    let q = "";
    try {
      q = localStorage.getItem("selectedQuarter") ?? "";
    } catch {}
    if (q) {
      fetch(`/api/workers/potential?quarter_id=${q}`)
        .then((r) => r.json())
        .then((rows: { worker_id: string; shifts: number; weekends: number }[]) => {
          const row = rows.find((x) => x.worker_id === id);
          if (row) setStats({ shifts: row.shifts, weekends: row.weekends });
        })
        .catch(() => {});
    }
  }, [workerId]);

  if (missing) return <div className="py-16 text-center text-sm nocturne-text-muted">עובד לא נמצא</div>;
  if (!worker || !form) return <div className="py-16 text-center text-sm nocturne-text-muted">טוען...</div>;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(worker));
  const hint = releaseHint(form.release_date);

  async function save(patch?: Partial<Form>) {
    if (!form || !worker) return;
    const f = { ...form, ...patch };
    if (f.is_exempt && !f.exemption_reason.trim()) return toast.error("יש להזין סיבת פטור");
    setSaving(true);
    const res = await fetch(`/api/workers/${encodeURIComponent(worker.worker_id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.name,
        rank_id: f.rank_id,
        phone: f.phone || null,
        branch: f.branch || null,
        team: f.team || null,
        release_date: f.release_date || null,
        receives_shift_allocation: f.receives_shift_allocation,
        is_exempt: f.is_exempt,
        exemption_reason: f.exemption_reason,
        is_admin: f.is_admin,
        standing_constraints: f.standing_constraints || null,
        notes: f.notes || null,
        in_whatsapp_group: f.in_whatsapp_group,
        is_archived: f.is_archived,
        ...(f.password ? { password: f.password } : {}),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      return toast.error(err?.error ?? "שמירה נכשלה");
    }
    const rank_name = ranks.find((r) => r.rank_id === f.rank_id)?.name ?? worker.rank_name;
    const next = {
      ...worker,
      name: f.name,
      rank_id: f.rank_id,
      rank_name,
      phone: f.phone || null,
      branch: f.branch || null,
      team: f.team || null,
      release_date: f.release_date || null,
      receives_shift_allocation: f.receives_shift_allocation ? 1 : 0,
      is_exempt: f.is_exempt ? 1 : 0,
      exemption_reason: f.is_exempt ? f.exemption_reason : null,
      is_admin: f.is_admin ? 1 : 0,
      password_hash: f.password ? "set" : worker.password_hash,
      standing_constraints: f.standing_constraints || null,
      notes: f.notes || null,
      in_whatsapp_group: f.in_whatsapp_group ? 1 : 0,
      is_archived: f.is_archived ? 1 : 0,
      updated_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    } as WorkerRow;
    setWorker(next);
    setForm(toForm(next));
    toast.success("נשמר");
  }

  const wa = form.in_whatsapp_group;

  return (
    <div className="flex flex-col -mx-4 -mt-4 h-[calc(100%+1rem)]">
      <div className="flex items-center px-3 pt-2 pb-1">
        <button onClick={() => router.push("/admin/workers")} className="min-h-11 px-2 text-sm">
          › עובדים
        </button>
        {form.is_archived && (
          <span className="mr-auto text-[11.5px] px-2.5 py-1 rounded-md bg-[#292b31] nocturne-text-tertiary">ארכיון</span>
        )}
        {!form.is_archived && form.is_exempt && (
          <span className="mr-auto text-[11.5px] px-2.5 py-1 rounded-md bg-[#3f2b2f] nocturne-error">פטור</span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-[18px] pb-4 flex flex-col gap-3.5">
        <div className="flex items-center gap-3">
          <Avatar name={form.name} size={56} />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] tracking-[.12em] nocturne-accent">ישות · עובד</span>
            <span className="text-[21px] truncate">{form.name}</span>
            <span className="text-xs nocturne-text-muted font-sans">
              {worker.worker_id} · {worker.rank_name}
            </span>
          </div>
        </div>

        <div
          className={`min-h-[52px] flex items-center gap-2.5 px-3 py-2 rounded-xl ${
            wa ? "bg-[#1f2b28]" : "bg-[#2e2129]"
          }`}
        >
          <span className={`w-[9px] h-[9px] rounded-full ${wa ? "bg-[#86c9a4]" : "bg-[#e08a8a]"}`} />
          <span className="text-sm">{wa ? "בקבוצת הוואטסאפ" : "לא בקבוצת הוואטסאפ"}</span>
          <button
            onClick={() => set("in_whatsapp_group", !wa)}
            className="mr-auto min-h-9 px-3 text-xs rounded-lg border nocturne-border"
          >
            {wa ? "הסרה" : "סימון כצורף"}
          </button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 gap-2">
            {[
              ["משמרות ברבעון", stats.shifts],
              ["סופ״ש ברבעון", stats.weekends],
            ].map(([l, v]) => (
              <div key={l} className="px-3 py-2.5 rounded-xl bg-[#1f2130] flex flex-col gap-0.5">
                <span className="text-[11px] nocturne-text-muted">{l}</span>
                <span className="text-[19px] font-sans">{v}</span>
              </div>
            ))}
          </div>
        )}

        <Section>פרטים</Section>
        <div className="flex flex-col gap-2.5">
          <Field label="שם מלא">
            <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="מספר אישי">
              <input className={`${inputCls} font-sans opacity-70`} dir="ltr" value={worker.worker_id} readOnly />
            </Field>
            <Field label="דרגה">
              <select className={inputCls} value={form.rank_id} onChange={(e) => set("rank_id", e.target.value)}>
                {ranks.map((r) => (
                  <option key={r.rank_id} value={r.rank_id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="טלפון">
            <input className={`${inputCls} font-sans`} dir="ltr" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="ענף">
              <input className={inputCls} value={form.branch} onChange={(e) => set("branch", e.target.value)} />
            </Field>
            <Field label="צוות">
              <input className={inputCls} value={form.team} onChange={(e) => set("team", e.target.value)} />
            </Field>
          </div>
          <Field label="תאריך שחרור">
            <input type="date" className={`${inputCls} font-sans`} dir="ltr" value={form.release_date} onChange={(e) => set("release_date", e.target.value)} />
          </Field>
          {hint && <span className="text-[11.5px] nocturne-warning -mt-1">{hint}</span>}
        </div>

        <Section>שיבוץ</Section>
        <div className="rounded-xl bg-[#1f2130] flex flex-col divide-y divide-white/5">
          <ToggleRow label="מקבל הקצאת משמרות" hint="נכלל ברשימת המועמדים בשיבוץ" checked={form.receives_shift_allocation} onChange={(v) => set("receives_shift_allocation", v)} />
          <ToggleRow label="פטור ממשמרות" hint="מסומן באדום במסך השיבוץ" checked={form.is_exempt} onChange={(v) => set("is_exempt", v)} />
          {form.is_exempt && (
            <div className="px-3 pt-2.5 pb-3">
              <Field label="סיבת פטור">
                <input className={inputCls} value={form.exemption_reason} onChange={(e) => set("exemption_reason", e.target.value)} />
              </Field>
            </div>
          )}
        </div>
        <Field label="אילוצים קבועים">
          <textarea rows={2} className={`${inputCls} py-2`} value={form.standing_constraints} onChange={(e) => set("standing_constraints", e.target.value)} />
        </Field>
        <Field label="הערות">
          <textarea rows={2} className={`${inputCls} py-2`} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>

        <Section>גישה</Section>
        <div className="rounded-xl bg-[#1f2130] flex flex-col divide-y divide-white/5">
          <ToggleRow label="מנהל מערכת" hint="גישה למסכי הניהול והשיבוץ" checked={form.is_admin} onChange={(v) => set("is_admin", v)} />
          {form.is_admin && (
            <div className="px-3 pt-2.5 pb-3">
              <Field label={worker.password_hash ? "איפוס סיסמה (סיסמה חדשה)" : "הגדרת סיסמה"}>
                <input type="password" autoComplete="new-password" className={inputCls} dir="ltr" value={form.password} onChange={(e) => set("password", e.target.value)} />
              </Field>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 px-0.5 pt-1.5 text-[11.5px] nocturne-text-muted">
          <span className="flex justify-between"><span>נוצר</span><span className="font-sans">{fmtTs(worker.created_at)}</span></span>
          <span className="flex justify-between"><span>עודכן לאחרונה</span><span className="font-sans">{fmtTs(worker.updated_at)}</span></span>
        </div>

        <button
          onClick={() => save({ is_archived: !form.is_archived })}
          disabled={saving}
          className={`min-h-11 rounded-[10px] border text-[13.5px] ${
            form.is_archived ? "nocturne-border" : "border-[#6b3b40] nocturne-error"
          }`}
        >
          {form.is_archived ? "שחזור מארכיון" : "העברה לארכיון"}
        </button>
      </div>

      <div className="flex-none px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] border-t nocturne-border">
        <button
          onClick={() => save()}
          disabled={!dirty || saving}
          className="w-full min-h-12 rounded-[10px] text-[15px] nocturne-accent-bg text-[#161826] font-medium disabled:opacity-40"
        >
          {saving ? "שומר..." : "שמירת שינויים"}
        </button>
      </div>
    </div>
  );
}
