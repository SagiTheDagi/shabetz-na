"use client";

import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type React from "react";

export interface ExportRow {
  date: string;
  shift_type_name: string;
  is_weekend: boolean;
  shift_worker_name: string | null;
  shift_is_forced: boolean;
  reserve_worker_name: string | null;
  reserve_is_forced: boolean;
}

interface ExportImageModalProps {
  open: boolean;
  onClose: () => void;
  rows: ExportRow[];
  quarterId: string;
}

const HEBREW_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function getDayName(iso: string) {
  return HEBREW_DAYS[new Date(iso + "T00:00:00").getDay()];
}

function formatDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1)
    .toString()
    .padStart(2, "0")}/${d.getFullYear()}`;
}

const thStyle: React.CSSProperties = {
  padding: "8px 14px",
  textAlign: "right",
  fontWeight: "bold",
  borderBottom: "2px solid #c8c8c8",
  color: "#333",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "7px 14px",
  borderBottom: "1px solid #e4e4e4",
  color: "#111",
  whiteSpace: "nowrap",
};

export function ExportImageModal({
  open,
  onClose,
  rows,
  quarterId,
}: ExportImageModalProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const assigned = rows.filter((r) => r.shift_worker_name && r.reserve_worker_name).length;

  async function handleExport() {
    if (!tableRef.current) return;
    setExporting(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(tableRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });
      const link = document.createElement("a");
      link.download = `shabetz-${quarterId}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-3" dir="rtl">
        <DialogHeader>
          <DialogTitle>ייצוא תמונת שיבוץ — {quarterId}</DialogTitle>
        </DialogHeader>

        {/* Scrollable preview */}
        <div className="flex-1 overflow-auto border rounded bg-white">
          {/* The div that gets captured */}
          <div
            ref={tableRef}
            style={{
              backgroundColor: "#ffffff",
              padding: "28px 24px",
              fontFamily: "Arial, 'Segoe UI', sans-serif",
              direction: "rtl",
              minWidth: "520px",
            }}
          >
            {/* Header */}
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <div
                style={{
                  fontSize: "20px",
                  fontWeight: "bold",
                  color: "#111",
                  marginBottom: "4px",
                }}
              >
                שב&quot;צ-נא — {quarterId}
              </div>
              <div style={{ fontSize: "12px", color: "#777" }}>
                {assigned}/{rows.length} משמרות שובצו במלואן
              </div>
            </div>

            {/* Table */}
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "13px",
              }}
            >
              <thead>
                <tr style={{ backgroundColor: "#eef2f7" }}>
                  <th style={thStyle}>תאריך</th>
                  <th style={thStyle}>יום</th>
                  <th style={thStyle}>סוג משמרת</th>
                  <th style={{ ...thStyle, width: "50%" }}>משמרת</th>
                  <th style={{ ...thStyle, width: "50%" }}>רזרבה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const bgColor = row.is_weekend
                    ? "#f3eeff"
                    : i % 2 === 0
                    ? "#ffffff"
                    : "#f9f9f9";

                  return (
                    <tr key={i} style={{ backgroundColor: bgColor }}>
                      <td style={tdStyle}>{formatDate(row.date)}</td>
                      <td style={tdStyle}>{getDayName(row.date)}</td>
                      <td style={tdStyle}>
                        {row.shift_type_name}
                        {row.is_weekend && (
                          <span
                            style={{
                              marginRight: "6px",
                              fontSize: "11px",
                              color: "#7c3aed",
                              fontWeight: "bold",
                            }}
                          >
                            סופ&quot;ש
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          fontWeight: row.shift_worker_name ? "bold" : "normal",
                          color: row.shift_worker_name ? "#111" : "#aaa",
                        }}
                      >
                        {row.shift_worker_name ?? "—"}
                        {row.shift_is_forced && (
                          <span style={{ marginRight: "6px", fontSize: "11px", color: "#dc2626", fontWeight: "normal" }}>
                            (כפוי)
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          fontWeight: row.reserve_worker_name ? "bold" : "normal",
                          color: row.reserve_worker_name ? "#111" : "#aaa",
                        }}
                      >
                        {row.reserve_worker_name ?? "—"}
                        {row.reserve_is_forced && (
                          <span style={{ marginRight: "6px", fontSize: "11px", color: "#dc2626", fontWeight: "normal" }}>
                            (כפוי)
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Footer */}
            <div
              style={{
                textAlign: "center",
                fontSize: "11px",
                color: "#bbb",
                marginTop: "16px",
              }}
            >
              הופק מ-שב&quot;צ-נא
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ביטול
          </Button>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? "מייצא..." : "הורד PNG"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
