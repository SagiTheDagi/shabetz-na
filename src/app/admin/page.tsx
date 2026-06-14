"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DashboardStats {
  totalWorkers: number;
  totalShifts: number;
  assignedShifts: number;
  currentQuarter: string | null;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalWorkers: 0,
    totalShifts: 0,
    assignedShifts: 0,
    currentQuarter: null,
  });

  useEffect(() => {
    async function loadStats() {
      const [workersRes, quartersRes] = await Promise.all([
        fetch("/api/workers?include_exempt=true"),
        fetch("/api/quarters"),
      ]);

      const workers = await workersRes.json();
      const quarters = await quartersRes.json();

      const currentQuarter = quarters[0]?.quarter_id || null;

      let totalShifts = 0;
      let assignedShifts = 0;

      if (currentQuarter) {
        const [shiftsRes, assignmentsRes] = await Promise.all([
          fetch(`/api/shifts?quarter_id=${currentQuarter}`),
          fetch(`/api/assignments?quarter_id=${currentQuarter}`),
        ]);

        const shifts = await shiftsRes.json();
        const assignments = await assignmentsRes.json();

        totalShifts = shifts.length;
        assignedShifts = assignments.length;
      }

      setStats({
        totalWorkers: workers.length,
        totalShifts,
        assignedShifts,
        currentQuarter,
      });
    }

    loadStats();
  }, []);

  return (
    <div className="space-y-6">
      {stats.currentQuarter && (
        <p className="text-sm text-muted-foreground">
          רבעון נוכחי: <span className="font-medium text-foreground">{stats.currentQuarter}</span>
        </p>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">עובדים</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.totalWorkers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">שובצו</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {stats.assignedShifts}/{stats.totalShifts}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">ממתין</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.totalShifts - stats.assignedShifts}</p>
          </CardContent>
        </Card>
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/admin/upload">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>📤</span>
                <span>העלאת תאריכי משמרות</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">העלאת קובץ תאריכים לרבעון חדש</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/assign">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>📋</span>
                <span>מסך שיבוץ</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {stats.currentQuarter ? "המשך שיבוץ עובדים למשמרות" : "טרם הועלו תאריכים"}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
