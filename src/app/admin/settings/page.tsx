"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { RankManager } from "@/components/rank-manager";
import { ShiftTypeManager } from "@/components/shift-type-manager";
import { ShiftDateImport } from "@/components/shift-date-import";
import { FormResponseImport } from "@/components/form-response-import";

const TAB_VALUES = new Set([
  "form-responses",
  "shift-dates",
  "ranks",
  "shift-types",
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
          <TabsTrigger value="form-responses">ייבוא אילוצים</TabsTrigger>
          <TabsTrigger value="shift-dates">תאריכי משמרות</TabsTrigger>
          <TabsTrigger value="ranks">דרגות</TabsTrigger>
          <TabsTrigger value="shift-types">סוגי משמרות</TabsTrigger>
        </TabsList>

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
