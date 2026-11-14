/** Table helpers for insight tables. */
import type { Row } from "./result-store";

/** Stable sort by one column; nulls last; numbers numerically, text with Hebrew collation. */
export function sortRows(rows: Row[], key: string, dir: "asc" | "desc"): Row[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const x = a.r[key];
      const y = b.r[key];
      if (x === null || x === undefined || x === "") return y === null || y === undefined || y === "" ? a.i - b.i : 1;
      if (y === null || y === undefined || y === "") return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "he", { numeric: true });
      return c !== 0 ? sign * c : a.i - b.i;
    })
    .map(({ r }) => r);
}
