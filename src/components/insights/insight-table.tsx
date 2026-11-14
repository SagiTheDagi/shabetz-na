"use client";

/** Sortable table for a server-validated TableSpec, with CSV export. */
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { cellText, toCsv, sortRows } from "@/lib/insights/csv";
import type { TableSpec } from "@/lib/insights/render";

export function downloadCsv(title: string, columns: TableSpec["columns"], data: TableSpec["data"], truncated?: boolean) {
  const note = truncated ? `הנתונים קוצרו: מוצגות ${data.length} השורות הראשונות בלבד.` : undefined;
  const blob = new Blob([toCsv(columns, data, note)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[\\/:*?"<>|]+/g, "_") || "insight"}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function InsightTable({ spec, maxHeight = 360 }: { spec: TableSpec; maxHeight?: number }) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const rows = useMemo(() => (sort ? sortRows(spec.data, sort.key, sort.dir) : spec.data), [spec.data, sort]);

  const toggle = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: "desc" } : s.dir === "desc" ? { key, dir: "asc" } : null));

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-auto rounded-lg border border-white/5" style={{ maxHeight }}>
        <table className="w-full text-[12.5px] border-collapse">
          <thead className="sticky top-0 nocturne-surface">
            <tr>
              {spec.columns.map((c) => (
                <th key={c.key} className="text-right font-medium px-3 py-2 border-b border-white/5 whitespace-nowrap">
                  <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 hover:opacity-80">
                    {c.label}
                    {sort?.key === c.key &&
                      (sort.dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-white/[0.03] last:border-b-0">
                {spec.columns.map((c) => (
                  <td key={c.key} className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                    {cellText(r[c.key]) || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 text-[11px] nocturne-text-muted">
        <span>{spec.data.length} שורות</span>
        <button
          type="button"
          onClick={() => downloadCsv(spec.title, spec.columns, rows, spec.truncated)}
          className="inline-flex items-center gap-1 hover:opacity-80"
        >
          <Download className="size-3" /> ייצוא CSV
        </button>
      </div>
    </div>
  );
}
