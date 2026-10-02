import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fromIsoDate,
  hebrewDayName,
  isWeekend,
  toDisplayDate,
  toIsoDate,
  toShortDate,
} from "./date-utils";

test("toIsoDate pads month and day", () => {
  assert.equal(toIsoDate(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(toIsoDate(new Date(2026, 11, 31)), "2026-12-31");
});

test("toIsoDate keeps leap day", () => {
  assert.equal(toIsoDate(new Date(2028, 1, 29)), "2028-02-29");
});

test("fromIsoDate/toIsoDate round-trip", () => {
  for (const iso of ["2026-01-01", "2026-03-29", "2026-10-25", "2028-02-29", "2026-12-31"]) {
    assert.equal(toIsoDate(fromIsoDate(iso)), iso);
  }
});

test("fromIsoDate yields local midnight", () => {
  const d = fromIsoDate("2026-01-05");
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 0, 5, 0]);
});

test("toDisplayDate / toShortDate", () => {
  assert.equal(toDisplayDate("2026-01-05"), "05/01/2026");
  assert.equal(toShortDate("2026-01-05"), "05/01");
});

test("hebrewDayName", () => {
  assert.equal(hebrewDayName("2026-01-04"), "ראשון");
  assert.equal(hebrewDayName("2026-01-05"), "שני");
  assert.equal(hebrewDayName("2026-01-10"), "שבת");
  assert.equal(hebrewDayName("2026-12-31"), "חמישי");
});

test("isWeekend is Thu-Sat only", () => {
  const flags = [4, 5, 6, 7, 8, 9, 10].map((day) => isWeekend(new Date(2026, 0, day)));
  // Jan 4 2026 = Sunday .. Jan 10 = Saturday
  assert.deepEqual(flags, [false, false, false, false, true, true, true]);
});
