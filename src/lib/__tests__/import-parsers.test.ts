import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWorkersXlsx, parseCsvWorkers, excelDateToIso, normalizePhone } from "../worker-file-parser";
import { parseXlsxSheets, parseCsvFile, parseCsvDate, parseWeekendRange, parseSheetDates } from "../shift-date-file-parser";
import { parseFormBuffer, autoMatchWorker, type WorkerOption } from "../form-response-parser";

const fx = (name: string) => join(import.meta.dirname, "fixtures", name);
const buf = (name: string): ArrayBuffer => {
  const b = readFileSync(fx(name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const text = (name: string) => readFileSync(fx(name), "utf-8");

describe("excelDateToIso / normalizePhone", () => {
  test("serial -> ISO, invalid -> null", () => {
    assert.equal(excelDateToIso(46387), "2026-12-31");
    assert.equal(excelDateToIso(25569), "1970-01-01");
    for (const v of [null, undefined, "", "abc", 0, -5]) assert.equal(excelDateToIso(v), null);
  });
  test("phone: restores leading 0, strips separators, keeps +", () => {
    assert.equal(normalizePhone(501234567), "0501234567");
    assert.equal(normalizePhone("052-765-4321"), "0527654321");
    assert.equal(normalizePhone(" 050 123 4567 "), "0501234567");
    assert.equal(normalizePhone("+972501112222"), "+972501112222");
    assert.equal(normalizePhone("   "), null);
    assert.equal(normalizePhone(null), null);
  });
  test("phone: 9-digit non-5 numbers are left alone", () => {
    assert.equal(normalizePhone(212345678), "212345678");
  });
});

describe("parseWorkersXlsx (mock file)", () => {
  const { workers, errors } = parseWorkersXlsx(buf("workers.xlsx"));
  test("skips header, rows without id; reports missing mandatory fields", () => {
    assert.deepEqual(workers.map((w) => w.worker_id), ["1001", "1002", "1003", "A-77"]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /חסרים שדות חובה/);
  });
  test("name is 'first last'; phone/release normalised", () => {
    const w = workers[0];
    assert.equal(w.name, "דני כהן");
    assert.equal(w.file_rank, "סמל");
    assert.equal(w.phone, "0501234567");
    assert.equal(w.release_date, "2026-12-31");
    assert.equal(w.notes, "יום לימודים ג'");
    assert.equal(w.exemption_reason, null);
    assert.equal(workers[1].phone, "0527654321");
  });
  test("'לא כשיר' -> exempt, notes become exemption reason", () => {
    const w = workers[2];
    assert.equal(w.is_exempt, 1);
    assert.equal(w.exemption_reason, "פציעה בברך");
    assert.equal(w.notes, null);
  });
  test("release 0 -> null; missing eligibility -> not exempt", () => {
    assert.equal(workers[3].release_date, null);
    assert.equal(workers[3].is_exempt, 0);
  });
  test("headerless file keeps first row", () => {
    const r = parseWorkersXlsx(buf("workers-noheader.xlsx"));
    assert.equal(r.workers.length, 1);
    assert.equal(r.workers[0].worker_id, "2001");
  });
  test("empty sheet -> no workers, no crash", () => {
    const r = parseWorkersXlsx(buf("workers-empty.xlsx"));
    assert.deepEqual(r.workers, []);
  });
});

describe("parseCsvWorkers (mock file)", () => {
  const ranks = new Set(["סמל", "רב סמל"]);
  const { workers, errors } = parseCsvWorkers(text("workers.csv"), ranks);
  test("BOM/CRLF/comment/tab handled", () => {
    assert.deepEqual(workers.map((w) => w.worker_id), ["1001", "1002", "1003", "1005"]);
    assert.equal(workers[2].name, "יוסי");
  });
  test("exempt + reason + receives_shift_allocation=0", () => {
    assert.equal(workers[1].is_exempt, 1);
    assert.equal(workers[1].exemption_reason, "פטור רפואי");
    assert.equal(workers[1].receives_shift_allocation, 0);
    assert.equal(workers[0].receives_shift_allocation, 1);
  });
  test("errors: missing name; unknown rank flagged but worker kept", () => {
    assert.equal(errors.length, 2);
    assert.match(errors[0], /חסרים/);
    assert.match(errors[1], /לא-קיים/);
  });
  test("empty rank set disables rank validation", () => {
    assert.equal(parseCsvWorkers("1,a,zzz", new Set()).errors.length, 0);
  });
  test("empty input", () => {
    assert.deepEqual(parseCsvWorkers("", ranks), { workers: [], errors: [] });
  });
  test("exemption reason ignored when not exempt", () => {
    assert.equal(parseCsvWorkers("1,a,r,0,reason", new Set()).workers[0].exemption_reason, null);
  });
});

describe("shift-date parsers", () => {
  test("parseCsvDate formats and rejects", () => {
    const iso = (d: Date | null) => d && `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    assert.equal(iso(parseCsvDate("05/01/2026")), "2026-1-5");
    assert.equal(iso(parseCsvDate("5 . 1 . 26")), "2026-1-5");
    assert.equal(parseCsvDate("garbage"), null);
    assert.equal(parseCsvDate(""), null);
  });
  test("parseCsvDate ISO is timezone-stable (local calendar day preserved)", () => {
    const d = parseCsvDate("2026-01-05")!;
    assert.equal(d.getDate(), 5);
    assert.equal(d.getMonth(), 0);
  });
  test("parseWeekendRange: dot and slash forms, bad input", () => {
    assert.equal(parseWeekendRange("9-10/1/2026")?.getDate(), 9);
    assert.equal(parseWeekendRange("15.1-16.1.2026")?.getMonth(), 0);
    assert.equal(parseWeekendRange("9-10"), null);
  });
  test("parseCsvFile: header skipped, sorted, default type, BOM", () => {
    const d = parseCsvFile(text("shift-dates.csv"), "DEF");
    assert.deepEqual(d.map((x) => x.date), ["2026-01-05", "2026-01-07", "2026-01-08"]);
    assert.deepEqual(d.map((x) => x.shift_type_id), ["DEF", "ערב", "בוקר"]);
    assert.equal(d[2].is_weekend, true); // Thursday
    assert.equal(d[0].day_name, "שני");
  });
  test("parseCsvFile: first line a date -> not treated as header", () => {
    assert.equal(parseCsvFile("2026-01-05\n2026-01-06", "A").length, 2);
  });
  test("parseCsvFile empty", () => assert.deepEqual(parseCsvFile("", "A"), []));
  test("parseSheetDates: empty rows & junk skipped", () => {
    assert.deepEqual(parseSheetDates([["תאריך"], [null], [""], ["junk"]]), []);
  });
  test("parseXlsxSheets (mock file): per-sheet groups, empty/junk sheets dropped", () => {
    const g = parseXlsxSheets(buf("shift-dates.xlsx"));
    assert.deepEqual(g.map((x) => x.sheetName), ["בוקר", "ערב"]);
    assert.equal(g[0].dates.length, 5); // 2 serial + 05/01 string + 2 ranges
    assert.equal(g[1].dates.length, 2);
    const days = g[0].dates.map((d) => d.date.getDate());
    assert.deepEqual(days, [4, 8, 5, 9, 15]);
    assert.equal(g[0].dates[1].isWeekend, true);
  });
});

describe("form responses", () => {
  test("xlsx: skips header + nameless rows, trims, keeps multiline", () => {
    const rows = parseFormBuffer(buf("form-responses.xlsx"), false);
    assert.deepEqual(rows.map((r) => r.name), ["דני כהן", "לוי רונית", "יוסי ישראלי"]);
    assert.equal(rows[2].constraints, "שורה1\nשורה2");
    assert.equal(rows[0].mode, "replace");
    assert.equal(rows[0].included, true);
    assert.deepEqual(rows.map((r) => r.id), [0, 1, 2]);
  });
  test("csv: BOM stripped, quoted field", () => {
    const rows = parseFormBuffer(buf("form-responses.csv"), true);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, "דני כהן");
    assert.equal(rows[0].constraints, "לא יכול 5.1");
  });
  test("empty workbook -> []", () => {
    assert.deepEqual(parseFormBuffer(buf("workers-empty.xlsx"), false), []);
  });
});

describe("autoMatchWorker", () => {
  const W = (id: string, name: string): WorkerOption => ({ worker_id: id, name, notes: null, standing_constraints: null });
  const ws = [W("1", "דני כהן"), W("2", "רונית לוי"), W("3", "")];
  test("exact (case/space-insensitive)", () => assert.equal(autoMatchWorker("  דני כהן ", ws), "1"));
  test("reversed name", () => assert.equal(autoMatchWorker("לוי רונית", ws), "2"));
  test("substring", () => assert.equal(autoMatchWorker("רונית", ws), "2"));
  test("no match / empty", () => {
    assert.equal(autoMatchWorker("משה", [W("1", "דני כהן")]), "");
    assert.equal(autoMatchWorker("", ws), "");
  });
  test("worker with empty name never matches by substring", () => {
    assert.equal(autoMatchWorker("מישהו אחר", [W("3", "")]), "");
  });
});
