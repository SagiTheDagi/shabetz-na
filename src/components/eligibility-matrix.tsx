"use client";

import { useState, useEffect, useCallback } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import type { Rank, ShiftType, RankShiftEligibility } from "@/lib/types";

export function EligibilityMatrix() {
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [matrix, setMatrix] = useState<Map<string, number | null>>(new Map());

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

    if (input === null) return; // cancelled

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

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        לחץ על תא כדי לשנות כשירות. לחץ כפול על תא כשיר כדי להגדיר עדיפות.
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>דרגה</TableHead>
              {shiftTypes.map((st) => (
                <TableHead key={st.shift_type_id} className="text-center">
                  {st.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranks.map((rank) => (
              <TableRow key={rank.rank_id}>
                <TableCell className="font-medium">{rank.name}</TableCell>
                {shiftTypes.map((st) => {
                  const eligible = isEligible(rank.rank_id, st.shift_type_id);
                  const priority = getPriority(rank.rank_id, st.shift_type_id);
                  return (
                    <TableCell
                      key={st.shift_type_id}
                      className={`text-center cursor-pointer select-none transition-colors ${
                        eligible
                          ? "bg-green-100 dark:bg-green-950 hover:bg-green-200 dark:hover:bg-green-900"
                          : "bg-muted/50 hover:bg-muted"
                      }`}
                      onClick={() => toggleCell(rank.rank_id, st.shift_type_id)}
                      onDoubleClick={() => setPriority(rank.rank_id, st.shift_type_id)}
                    >
                      {eligible ? (
                        priority ? (
                          <span className="font-bold text-green-800">
                            ✓({priority})
                          </span>
                        ) : (
                          <span className="text-green-700">✓</span>
                        )
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
