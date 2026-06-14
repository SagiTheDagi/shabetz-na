"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import type { Quarter, ShiftType } from "@/lib/types";
import type { ParsedShiftDate } from "@/lib/file-parser";

export default function UploadPage() {
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [selectedQuarter, setSelectedQuarter] = useState<string>("");
  const [showNewQuarter, setShowNewQuarter] = useState(false);
  const [newQuarterId, setNewQuarterId] = useState("");
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const [parsedDates, setParsedDates] = useState<ParsedShiftDate[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const loadData = useCallback(async () => {
    const [qRes, stRes] = await Promise.all([
      fetch("/api/quarters"),
      fetch("/api/shift-types"),
    ]);
    setQuarters(await qRes.json());
    setShiftTypes(await stRes.json());
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const content = await file.text();
    // Parse client-side using same logic
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));

    const dates: ParsedShiftDate[] = [];
    const errs: string[] = [];
    const defaultType = shiftTypes[0]?.shift_type_id || "OFFICER";
    const hebrewDays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(/[,\t]+/).map((p) => p.trim());
      const dateStr = parts[0];
      const shiftTypeId = parts[1] || defaultType;

      // Parse date
      let parsed: Date | null = null;
      const dmyMatch = dateStr.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
      if (dmyMatch) {
        let year = parseInt(dmyMatch[3], 10);
        if (year < 100) year += 2000;
        parsed = new Date(year, parseInt(dmyMatch[2], 10) - 1, parseInt(dmyMatch[1], 10));
      } else {
        const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) parsed = new Date(dateStr);
      }

      if (!parsed || isNaN(parsed.getTime())) {
        errs.push(`שורה ${i + 1}: תאריך לא תקין "${dateStr}"`);
        continue;
      }

      const day = parsed.getDay();
      const isWeekend = day === 4 || day === 5 || day === 6;

      dates.push({
        date: parsed.toISOString().split("T")[0],
        shift_type_id: shiftTypeId,
        is_weekend: isWeekend,
        display_date: `${parsed.getDate().toString().padStart(2, "0")}/${(parsed.getMonth() + 1).toString().padStart(2, "0")}/${parsed.getFullYear()}`,
        day_name: hebrewDays[day],
      });
    }

    dates.sort((a, b) => a.date.localeCompare(b.date));
    setParsedDates(dates);
    setErrors(errs);
  }

  async function handleCreateQuarter() {
    if (!newQuarterId || !newStartDate || !newEndDate) return;
    const res = await fetch("/api/quarters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quarter_id: newQuarterId,
        start_date: newStartDate,
        end_date: newEndDate,
      }),
    });
    if (res.ok) {
      toast.success("רבעון נוצר");
      setSelectedQuarter(newQuarterId);
      setShowNewQuarter(false);
      loadData();
    } else {
      const data = await res.json();
      toast.error(data.error);
    }
  }

  async function handleUpload() {
    if (!selectedQuarter || parsedDates.length === 0) return;
    setUploading(true);

    const res = await fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quarter_id: selectedQuarter,
        dates: parsedDates.map((d) => ({
          date: d.date,
          shift_type_id: d.shift_type_id,
          is_weekend: d.is_weekend,
        })),
      }),
    });

    if (res.ok) {
      toast.success(`${parsedDates.length} תאריכים הועלו בהצלחה`);
      setParsedDates([]);
    } else {
      const data = await res.json();
      toast.error(data.error);
    }
    setUploading(false);
  }

  const shiftTypeMap = new Map(shiftTypes.map((st) => [st.shift_type_id, st.name]));
  const weekendCount = parsedDates.filter((d) => d.is_weekend).length;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Quarter selector */}
      <Card>
        <CardHeader>
          <CardTitle>בחירת רבעון</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Label>רבעון</Label>
              <Select value={selectedQuarter} onValueChange={(v) => v && setSelectedQuarter(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="בחר רבעון" />
                </SelectTrigger>
                <SelectContent>
                  {quarters.map((q) => (
                    <SelectItem key={q.quarter_id} value={q.quarter_id}>
                      {q.quarter_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => setShowNewQuarter(!showNewQuarter)}>
              + רבעון חדש
            </Button>
          </div>

          {showNewQuarter && (
            <div className="flex gap-2 items-end border-t pt-4">
              <div className="space-y-1">
                <Label>מזהה (2026-Q3)</Label>
                <Input value={newQuarterId} onChange={(e) => setNewQuarterId(e.target.value)} placeholder="2026-Q3" className="w-32" />
              </div>
              <div className="space-y-1">
                <Label>תחילה</Label>
                <Input type="date" value={newStartDate} onChange={(e) => setNewStartDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>סיום</Label>
                <Input type="date" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)} />
              </div>
              <Button onClick={handleCreateQuarter}>צור</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* File upload */}
      <Card>
        <CardHeader>
          <CardTitle>העלאת קובץ תאריכים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
            <input
              type="file"
              accept=".csv,.txt,.tsv"
              onChange={handleFileChange}
              className="block mx-auto text-sm"
            />
            <p className="text-xs text-muted-foreground mt-2">
              CSV / TXT — כל שורה: תאריך, סוג משמרת (אופציונלי)
            </p>
          </div>

          {errors.length > 0 && (
            <div className="bg-red-50 p-3 rounded text-sm text-red-700 space-y-1">
              {errors.map((err, i) => (
                <p key={i}>{err}</p>
              ))}
            </div>
          )}

          {parsedDates.length > 0 && (
            <>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{parsedDates.length} תאריכים</span>
                <span>{weekendCount} סופ&quot;ש</span>
              </div>

              <div className="max-h-80 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>תאריך</TableHead>
                      <TableHead>יום</TableHead>
                      <TableHead>סוג משמרת</TableHead>
                      <TableHead>סופ&quot;ש</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedDates.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell>{d.display_date}</TableCell>
                        <TableCell>{d.day_name}</TableCell>
                        <TableCell>{shiftTypeMap.get(d.shift_type_id) || d.shift_type_id}</TableCell>
                        <TableCell>{d.is_weekend ? "✓" : ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Button
                onClick={handleUpload}
                disabled={!selectedQuarter || uploading}
                className="w-full"
              >
                {uploading ? "מעלה..." : "אישור והעלאה"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
