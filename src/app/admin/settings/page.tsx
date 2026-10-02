"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { SimpleCrudTable } from "@/components/simple-crud-table";
import { ShiftDateImport } from "@/components/shift-date-import";
import { FormResponseImport } from "@/components/form-response-import";
import { MobileShiftDates } from "@/components/mobile/shift-dates-mobile";
import { useIsMobile } from "@/lib/use-media";

const TAB_VALUES = new Set([
  "form-responses",
  "shift-dates",
  "ranks",
  "shift-types",
]);

function SettingsTabs() {
  const isMobile = useIsMobile();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  // Honor a ?tab= query param (e.g. deep links from the assign page).
  const [tab, setTab] = useState(
    tabParam && TAB_VALUES.has(tabParam) ? tabParam : "shift-dates"
  );

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)} dir="rtl">
        <TabsList className="max-w-full overflow-x-auto">
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
          {isMobile ? <MobileShiftDates /> : <ShiftDateImport />}
        </TabsContent>

        <TabsContent value="ranks">
          <Card>
            <CardContent className="pt-6">
              <SimpleCrudTable
                apiPath="/api/ranks"
                idField="rank_id"
                nameColumnLabel="שם דרגה"
                idPlaceholder="OL5"
                namePlaceholder="שם הדרגה"
                addButtonLabel="הוסף דרגה"
                confirmDelete="למחוק דרגה זו?"
                messages={{ added: "דרגה נוספה", updated: "דרגה עודכנה", deleted: "דרגה נמחקה" }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shift-types">
          <Card>
            <CardContent className="pt-6">
              <SimpleCrudTable
                apiPath="/api/shift-types"
                idField="shift_type_id"
                nameColumnLabel="שם סוג משמרת"
                idPlaceholder="PATROL"
                idInputClassName="w-32"
                namePlaceholder="שם סוג המשמרת"
                addButtonLabel="הוסף סוג"
                confirmDelete="למחוק סוג משמרת זה?"
                messages={{ added: "סוג משמרת נוסף", updated: "סוג משמרת עודכן", deleted: "סוג משמרת נמחק" }}
              />
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
