"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { handleImportInput, isExcelFile } from "@/lib/file-import";
import type { Quarter, ShiftType } from "@/lib/types";
import type { ParsedShiftDate } from "@/lib/file-parser";
import { parseXlsxSheets, parseCsvFile, makeParsedDate, type SheetGroup } from "@/lib/shift-date-file-parser";

export function ShiftDateImport() {
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [selectedQuarter, setSelectedQuarter] = useState<string>("");
  const [showNewQuarter, setShowNewQuarter] = useState(false);
  const [newQuarterId, setNewQuarterId] = useState("");
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const [sheetGroups, setSheetGroups] = useState<SheetGroup[]>([]);
  const [sheetMappings, setSheetMappings] = useState<Record<string, string>>({});
  const [parsedDates, setParsedDates] = useState<ParsedShiftDate[]>([]);
  const [uploading, setUploading] = useState(false);

  const loadData = useCallback(async () => {
    const [qRes, stRes] = await Promise.all([fetch("/api/quarters"), fetch("/api/shift-types")]);
    setQuarters(await qRes.json());
    setShiftTypes(await stRes.json());
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    return handleImportInput(e, async (file) => {
      setSheetGroups([]);
      setSheetMappings({});
      setParsedDates([]);

      const defaultType = shiftTypes[0]?.shift_type_id ?? "";

      if (isExcelFile(file)) {
        const groups = parseXlsxSheets(await file.arrayBuffer());
        if (groups.length === 0) {
          toast.error("לא נמצאו תאריכים בקובץ");
          return;
        }
        const defaultMappings: Record<string, string> = {};
        for (const g of groups) defaultMappings[g.sheetName] = defaultType;
        setSheetGroups(groups);
        setSheetMappings(defaultMappings);
        toast.success(`נמצאו ${groups.length} גיליונות עם ${groups.reduce((s, g) => s + g.dates.length, 0)} תאריכים`);
      } else {
        const content = await file.text();
        const dates = parseCsvFile(content, defaultType);
        if (dates.length === 0) {
          toast.error("לא נמצאו תאריכים תקינים בקובץ");
          return;
        }
        setParsedDates(dates);
        toast.success(`נמצאו ${dates.length} תאריכים`);
      }
    });
  }

  function confirmSheetMappings() {
    const all: ParsedShiftDate[] = [];
    for (const g of sheetGroups) {
      const shiftTypeId = sheetMappings[g.sheetName] ?? shiftTypes[0]?.shift_type_id ?? "";
      for (const raw of g.dates) {
        all.push(makeParsedDate(raw.date, shiftTypeId));
      }
    }
    all.sort((a, b) => a.date.localeCompare(b.date));
    setParsedDates(all);
    setSheetGroups([]);
    toast.success(`${all.length} תאריכים מוכנים להעלאה`);
  }

  async function handleCreateQuarter() {
    if (!newQuarterId || !newStartDate || !newEndDate) return;
    const res = await fetch("/api/quarters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quarter_id: newQuarterId, start_date: newStartDate, end_date: newEndDate }),
    });
    if (res.ok) {
      toast.success("רבעון נוצר");
      setSelectedQuarter(newQuarterId);
      setShowNewQuarter(false);
      loadData();
    } else {
      toast.error((await res.json()).error);
    }
  }

  async function handleUpload() {
    if (!selectedQuarter || parsedDates.length === 0) return;
    setUploading(true);

    const quarter = quarters.find((q) => q.quarter_id === selectedQuarter);
    const filtered = quarter
      ? parsedDates.filter((d) => d.date >= quarter.start_date && d.date <= quarter.end_date)
      : parsedDates;

    if (filtered.length < parsedDates.length) {
      toast.info(`סוננו ${parsedDates.length - filtered.length} תאריכים מחוץ לטווח הרבעון`);
    }

    const res = await fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quarter_id: selectedQuarter,
        dates: filtered.map((d) => ({ date: d.date, shift_type_id: d.shift_type_id, is_weekend: d.is_weekend })),
      }),
    });

    if (res.ok) {
      toast.success(`${filtered.length} תאריכים הועלו בהצלחה`);
      setParsedDates([]);
    } else {
      toast.error((await res.json()).error);
    }
    setUploading(false);
  }

  const shiftTypeMap = new Map(shiftTypes.map((st) => [st.shift_type_id, st.name]));
  const weekendCount = parsedDates.filter((d) => d.is_weekend).length;
  const allMapped = sheetGroups.length > 0 && sheetGroups.every((g) => sheetMappings[g.sheetName]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>בחירת רבעון</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Label>רבעון</Label>
              <Select value={selectedQuarter} onValueChange={(v) => v && setSelectedQuarter(v)}>
                <SelectTrigger><SelectValue placeholder="בחר רבעון" /></SelectTrigger>
                <SelectContent>
                  {quarters.map((q) => (
                    <SelectItem key={q.quarter_id} value={q.quarter_id}>{q.quarter_id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => setShowNewQuarter(!showNewQuarter)}>+ רבעון חדש</Button>
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

      <Card>
        <CardHeader><CardTitle>העלאת קובץ תאריכים</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
            <input
              type="file"
              accept=".csv,.txt,.tsv,.xlsx,.xls"
              onChange={handleFileChange}
              className="block mx-auto text-sm"
            />
            <p className="text-xs text-muted-foreground mt-2">XLSX / CSV — כל גיליון = סוג משמרת</p>
          </div>

          {sheetGroups.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">שייך כל גיליון לסוג משמרת:</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>גיליון</TableHead>
                    <TableHead>תאריכים</TableHead>
                    <TableHead>סוג משמרת</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sheetGroups.map((g) => (
                    <TableRow key={g.sheetName}>
                      <TableCell className="font-medium">{g.sheetName}</TableCell>
                      <TableCell>{g.dates.length}</TableCell>
                      <TableCell>
                        <Select
                          value={sheetMappings[g.sheetName] ?? ""}
                          onValueChange={(v) => setSheetMappings((prev) => ({ ...prev, [g.sheetName]: v as string }))}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue placeholder="בחר סוג משמרת" />
                          </SelectTrigger>
                          <SelectContent>
                            {shiftTypes.map((st) => (
                              <SelectItem key={st.shift_type_id} value={st.shift_type_id}>
                                {st.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button onClick={confirmSheetMappings} disabled={!allMapped} className="w-full">
                אישור מיפוי וטעינת תאריכים
              </Button>
            </div>
          )}

          {parsedDates.length > 0 && (
            <>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{parsedDates.length} תאריכים</span>
                <span>{weekendCount} סופ&quot;ש / חגים</span>
                {selectedQuarter && (() => {
                  const q = quarters.find((q) => q.quarter_id === selectedQuarter);
                  if (!q) return null;
                  const inRange = parsedDates.filter((d) => d.date >= q.start_date && d.date <= q.end_date).length;
                  return inRange < parsedDates.length
                    ? <span className="text-amber-500">{inRange} בטווח הרבעון הנבחר</span>
                    : null;
                })()}
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

              <Button onClick={handleUpload} disabled={!selectedQuarter || uploading} className="w-full">
                {uploading ? "מעלה..." : "אישור והעלאה"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
