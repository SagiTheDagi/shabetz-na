"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { Rank, ShiftType, RankShiftEligibility } from "@/lib/types";

export default function EligibilityPage() {
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [matrix, setMatrix] = useState<Map<string, number | null>>(new Map());
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    const [ranksRes, typesRes, eligRes] = await Promise.all([
      fetch("/api/ranks"),
      fetch("/api/shift-types"),
      fetch("/api/eligibility"),
    ]);
    const ranksData: Rank[] = await ranksRes.json();
    const typesData: ShiftType[] = await typesRes.json();
    const eligData: RankShiftEligibility[] = await eligRes.json();

    setRanks(ranksData);
    setShiftTypes(typesData);

    const m = new Map<string, number | null>();
    for (const e of eligData) {
      m.set(`${e.rank_id}:${e.shift_type_id}`, e.priority);
    }
    setMatrix(m);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function getKey(rankId: string, shiftTypeId: string) {
    return `${rankId}:${shiftTypeId}`;
  }

  function isEligible(rankId: string, shiftTypeId: string) {
    return matrix.has(getKey(rankId, shiftTypeId));
  }

  function getPriority(rankId: string, shiftTypeId: string): number | null {
    return matrix.get(getKey(rankId, shiftTypeId)) ?? null;
  }

  async function toggleCell(rankId: string, shiftTypeId: string) {
    const key = getKey(rankId, shiftTypeId);
    const newMatrix = new Map(matrix);

    if (newMatrix.has(key)) {
      newMatrix.delete(key);
    } else {
      newMatrix.set(key, null);
    }
    setMatrix(newMatrix);
    await saveMatrix(newMatrix);
  }

  async function setPriority(rankId: string, shiftTypeId: string) {
    const key = getKey(rankId, shiftTypeId);
    if (!matrix.has(key)) return;

    const current = matrix.get(key);
    const input = prompt("הזן מספר עדיפות (1 = גבוהה ביותר, ריק = ללא עדיפות):", current?.toString() || "");

    if (input === null) return;

    const newMatrix = new Map(matrix);
    if (input.trim() === "") {
      newMatrix.set(key, null);
    } else {
      const num = parseInt(input, 10);
      if (isNaN(num) || num < 1) {
        toast.error("מספר עדיפות לא תקין");
        return;
      }
      newMatrix.set(key, num);
    }
    setMatrix(newMatrix);
    await saveMatrix(newMatrix);
  }

  async function saveMatrix(m: Map<string, number | null>) {
    const entries: { rank_id: string; shift_type_id: string; priority: number | null }[] = [];
    for (const [key, priority] of m) {
      const [rank_id, shift_type_id] = key.split(":");
      entries.push({ rank_id, shift_type_id, priority });
    }

    const res = await fetch("/api/eligibility", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });

    if (res.ok) {
      toast.success("מטריצת כשירות עודכנה");
    } else {
      toast.error("שגיאה בשמירה");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[13px] nocturne-text-muted">טוען...</div>
      </div>
    );
  }

  // Stats
  const totalCells = ranks.length * shiftTypes.length;
  const eligibleCells = matrix.size;
  const withPriority = Array.from(matrix.values()).filter((v) => v !== null).length;

  return (
    <div className="flex flex-col gap-4 max-w-[1100px]">
      {/* Header stats */}
      <div className="flex items-center gap-4 text-[12px] nocturne-text-muted">
        <span>{ranks.length} דרגות</span>
        <span className="w-1 h-1 rounded-full bg-white/20" />
        <span>{shiftTypes.length} סוגי משמרות</span>
        <span className="w-1 h-1 rounded-full bg-white/20" />
        <span>{eligibleCells}/{totalCells} כשירים</span>
        <span className="w-1 h-1 rounded-full bg-white/20" />
        <span>{withPriority} עם עדיפות</span>
      </div>

      {/* Instructions */}
      <div className="p-3 rounded-lg nocturne-surface border border-white/5">
        <p className="text-[12px] nocturne-text-muted">
          <span className="font-medium">לחיצה בודדת</span> - הפעלה/ביטול כשירות |{" "}
          <span className="font-medium">לחיצה כפולה</span> - הגדרת עדיפות (1 = הגבוהה ביותר)
        </p>
      </div>

      {/* Matrix */}
      <div className="overflow-x-auto rounded-lg nocturne-surface border border-white/5">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-right text-[11px] font-medium py-3 px-4 nocturne-text-muted">דרגה</th>
              {shiftTypes.map((st) => (
                <th key={st.shift_type_id} className="text-center text-[11px] font-medium py-3 px-4 nocturne-text-muted min-w-[100px]">
                  {st.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranks.map((rank) => (
              <tr key={rank.rank_id} className="border-b border-white/5 last:border-b-0">
                <td className="py-3 px-4">
                  <span className="text-[13px] font-medium">{rank.name}</span>
                </td>
                {shiftTypes.map((st) => {
                  const eligible = isEligible(rank.rank_id, st.shift_type_id);
                  const priority = getPriority(rank.rank_id, st.shift_type_id);
                  return (
                    <td
                      key={st.shift_type_id}
                      className={`text-center py-3 px-4 cursor-pointer select-none transition-colors ${
                        eligible
                          ? "bg-green-500/10 hover:bg-green-500/20"
                          : "hover:bg-white/[0.03]"
                      }`}
                      onClick={() => toggleCell(rank.rank_id, st.shift_type_id)}
                      onDoubleClick={() => setPriority(rank.rank_id, st.shift_type_id)}
                    >
                      {eligible ? (
                        priority ? (
                          <span className="inline-flex items-center gap-1 text-green-400 font-medium text-[13px]">
                            <span className="w-5 h-5 rounded-full grid place-items-center bg-green-500/20 text-[11px]">
                              {priority}
                            </span>
                          </span>
                        ) : (
                          <span className="text-green-400 text-[14px]">✓</span>
                        )
                      ) : (
                        <span className="nocturne-text-tertiary text-[14px]">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-green-500/10 grid place-items-center text-green-400 text-[10px]">✓</span>
          <span className="nocturne-text-muted">כשיר</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-green-500/20 grid place-items-center text-green-400 text-[10px] font-medium">1</span>
          <span className="nocturne-text-muted">כשיר עם עדיפות</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded grid place-items-center nocturne-text-tertiary text-[10px]">—</span>
          <span className="nocturne-text-muted">לא כשיר</span>
        </div>
      </div>
    </div>
  );
}
