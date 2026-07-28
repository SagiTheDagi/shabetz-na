"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { RankManager } from "@/components/rank-manager";
import { ShiftTypeManager } from "@/components/shift-type-manager";
import { EligibilityMatrix } from "@/components/eligibility-matrix";
import { WorkerImport } from "@/components/worker-import";
import { WorkerManagement } from "@/components/worker-management";
import { ShiftDateImport } from "@/components/shift-date-import";
import { FormResponseImport } from "@/components/form-response-import";
import { JusticeChart } from "@/components/justice-chart";

const TAB_VALUES = new Set([
  "workers",
  "form-responses",
  "shift-dates",
  "ranks",
  "shift-types",
  "eligibility",
  "justice",
]);

function SettingsTabs() {
  const params = useSearchParams();
  const tabParam = params.get("tab");
  // Honor a ?tab= query param (e.g. deep links from the assign page).
  const [tab, setTab] = useState(
    tabParam && TAB_VALUES.has(tabParam) ? tabParam : "shift-dates"
  );

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)} dir="rtl">
        <TabsList>
          <TabsTrigger value="workers">עובדים</TabsTrigger>
          <TabsTrigger value="form-responses">ייבוא אילוצים</TabsTrigger>
          <TabsTrigger value="shift-dates">תאריכי משמרות</TabsTrigger>
          <TabsTrigger value="ranks">דרגות</TabsTrigger>
          <TabsTrigger value="shift-types">סוגי משמרות</TabsTrigger>
          <TabsTrigger value="eligibility">מטריצת כשירות</TabsTrigger>
          <TabsTrigger value="justice">טבלת צדק</TabsTrigger>
        </TabsList>

        <TabsContent value="workers">
          <Card>
            <CardContent className="pt-6 space-y-8">
              <WorkerManagement />
              <div className="border-t pt-6">
                <p className="text-sm font-medium mb-4">ייבוא עובדים מקובץ</p>
                <WorkerImport />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="form-responses">
          <Card>
            <CardContent className="pt-6">
              <FormResponseImport />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shift-dates">
          <ShiftDateImport />
        </TabsContent>

        <TabsContent value="ranks">
          <Card>
            <CardContent className="pt-6">
              <RankManager />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shift-types">
          <Card>
            <CardContent className="pt-6">
              <ShiftTypeManager />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="eligibility">
          <Card>
            <CardContent className="pt-6">
              <EligibilityMatrix />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="justice">
          <Card>
            <CardContent className="pt-6">
              <JusticeChart />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsTabs />
    </Suspense>
  );
}
