import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { parseShiftFile } from "./file-parser";

test("DMY and ISO inputs give the same ISO date and display date", () => {
  const { dates, errors } = parseShiftFile("05/01/2026\n2026-01-05", "A");
  assert.deepEqual(errors, []);
  for (const d of dates) {
    assert.equal(d.date, "2026-01-05");
    assert.equal(d.display_date, "05/01/2026");
    assert.equal(d.day_name, "שני");
  }
});

test("separators and two-digit year", () => {
  const { dates } = parseShiftFile("05.01.2026\n05-01-2026\n05/01/26", "A");
  assert.deepEqual(dates.map((d) => d.date), ["2026-01-05", "2026-01-05", "2026-01-05"]);
});

test("weekend flag is Thu-Sat", () => {
  const { dates } = parseShiftFile("2026-01-04\n2026-01-07\n2026-01-08\n2026-01-09\n2026-01-10", "A");
  assert.deepEqual(dates.map((d) => d.is_weekend), [false, false, true, true, true]);
});

test("skips comments and blank lines", () => {
  const { dates, errors } = parseShiftFile("# header\n\n2026-01-05\n   \n", "A");
  assert.equal(dates.length, 1);
  assert.deepEqual(errors, []);
});

test("per-line shift type overrides default (comma and tab)", () => {
  const { dates } = parseShiftFile("2026-01-05,B\n2026-01-06\tC\n2026-01-07", "A");
  assert.deepEqual(dates.map((d) => d.shift_type_id), ["B", "C", "A"]);
});

test("invalid line goes to errors, others still parse", () => {
  const { dates, errors } = parseShiftFile("2026-01-05\nabc\n2026-01-06", "A");
  assert.equal(dates.length, 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /שורה 2/);
  assert.match(errors[0], /abc/);
});

test("output sorted by date", () => {
  const { dates } = parseShiftFile("2026-02-01\n2026-01-01\n15/01/2026", "A");
  assert.deepEqual(dates.map((d) => d.date), ["2026-01-01", "2026-01-15", "2026-02-01"]);
});

test("date is timezone-independent (regression: toISOString shifted the day)", () => {
  const script = `
    import { parseShiftFile } from "./src/lib/file-parser";
    const { dates } = parseShiftFile("05/01/2026\\n2026-01-05\\n01/03/2026", "A");
    console.log(JSON.stringify(dates.map(d => [d.date, d.display_date])));
  `;
  for (const tz of ["Asia/Jerusalem", "America/New_York", "Pacific/Auckland", "UTC"]) {
    const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: { ...process.env, TZ: tz },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, `${tz}: ${r.stderr}`);
    assert.deepEqual(
      JSON.parse(r.stdout.trim()),
      [["2026-01-05", "05/01/2026"], ["2026-01-05", "05/01/2026"], ["2026-03-01", "01/03/2026"]],
      tz,
    );
  }
});
