import { test } from "node:test";
import assert from "node:assert/strict";
import { isWeekendDate, validateShiftDate } from "../shift-date-validation";

const q = { start_date: "2026-07-01", end_date: "2026-09-30" };
const sibs = [{ shift_date_id: "a", date: "2026-07-10", shift_type_id: "t1" }];

test("valid draft", () => {
  assert.equal(validateShiftDate({ date: "2026-07-11", shift_type_id: "t1" }, q, sibs), null);
});
test("out of range", () => {
  assert.equal(validateShiftDate({ date: "2026-10-01", shift_type_id: "t1" }, q, sibs), "out_of_range");
});
test("duplicate, but not against itself", () => {
  const d = { date: "2026-07-10", shift_type_id: "t1" };
  assert.equal(validateShiftDate(d, q, sibs), "duplicate");
  assert.equal(validateShiftDate(d, q, sibs, "a"), null);
});
test("invalid date", () => {
  assert.equal(validateShiftDate({ date: "nope", shift_type_id: "t1" }, q, sibs), "invalid_date");
});
test("weekend is Thu-Sat", () => {
  assert.equal(isWeekendDate("2026-07-09"), true); // Thu
  assert.equal(isWeekendDate("2026-07-12"), false); // Sun
});

test("calendar-impossible dates are invalid (no Date rollover)", () => {
  const range = { start_date: "2026-01-01", end_date: "2026-12-31" };
  for (const d of ["2026-02-30", "2026-04-31", "2026-02-29", "2026-13-01", "2026-00-10"]) {
    assert.equal(validateShiftDate({ date: d, shift_type_id: "G" }, range, []), "invalid_date", d);
  }
  const leap = { start_date: "2028-01-01", end_date: "2028-12-31" };
  assert.equal(validateShiftDate({ date: "2028-02-29", shift_type_id: "G" }, leap, []), null);
});
