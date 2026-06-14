"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { RankManager } from "@/components/rank-manager";
import { ShiftTypeManager } from "@/components/shift-type-manager";
import { EligibilityMatrix } from "@/components/eligibility-matrix";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="eligibility" dir="rtl">
        <TabsList>
          <TabsTrigger value="ranks">דרגות</TabsTrigger>
          <TabsTrigger value="shift-types">סוגי משמרות</TabsTrigger>
          <TabsTrigger value="eligibility">מטריצת כשירות</TabsTrigger>
        </TabsList>

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
      </Tabs>
    </div>
  );
}
