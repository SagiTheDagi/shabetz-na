import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NONE_VALUE,
  DEFAULT_STATUSES,
  filterOptions,
  matchesMulti,
  nextStatuses,
  parseStatuses,
  sameStatuses,
  workerStatus,
} from "../worker-filters";

describe("workerStatus", () => {
  it("archived wins over exempt", () => {
    assert.equal(workerStatus({ is_archived: 1, is_exempt: 1 }), "archived");
    assert.equal(workerStatus({ is_archived: 0, is_exempt: 1 }), "exempt");
    assert.equal(workerStatus({ is_exempt: 0 }), "active");
  });
});

describe("parseStatuses / sameStatuses", () => {
  it("dedupes and drops unknown values", () => {
    assert.deepEqual(parseStatuses("active,active,bogus"), ["active"]);
  });
  it("falls back to default when empty/invalid", () => {
    assert.deepEqual(parseStatuses(null), DEFAULT_STATUSES);
    assert.deepEqual(parseStatuses("bogus"), DEFAULT_STATUSES);
  });
  it("compares as sets", () => {
    assert.equal(sameStatuses(["active", "active"], DEFAULT_STATUSES), false);
    assert.equal(sameStatuses(["exempt", "active"], DEFAULT_STATUSES), true);
  });
});

describe("nextStatuses", () => {
  it("toggles a status", () => {
    assert.deepEqual(nextStatuses(["active", "exempt"], "exempt"), ["active"]);
    assert.deepEqual(nextStatuses(["active"], "archived"), ["active", "archived"]);
  });
  it("isolates when all selected", () => {
    assert.deepEqual(nextStatuses(["active", "exempt", "archived"], "exempt"), ["exempt"]);
  });
  it("never leaves none selected", () => {
    assert.deepEqual(nextStatuses(["active"], "active"), ["active"]);
  });
});

describe("filterOptions / matchesMulti", () => {
  const ws = [{ b: "ב" }, { b: "א" }, { b: null }, { b: " א " }];
  it("sorted distinct values + none option", () => {
    assert.deepEqual(filterOptions(ws, (w) => w.b, "ללא"), [
      ["א", "א"],
      ["ב", "ב"],
      [NONE_VALUE, "ללא"],
    ]);
  });
  it("no options when field never set", () => {
    assert.deepEqual(filterOptions([{ b: null }], (w) => w.b, "ללא"), []);
  });
  it("keeps stale selected values", () => {
    const opts = filterOptions([{ b: "א" }], (w) => w.b, "ללא", ["ישן"]);
    assert.deepEqual(opts, [
      ["א", "א"],
      ["ישן", "ישן"],
    ]);
  });
  it("matches selection, trimming and none", () => {
    assert.equal(matchesMulti([], "x"), true);
    assert.equal(matchesMulti(["א"], " א "), true);
    assert.equal(matchesMulti(["א"], "ב"), false);
    assert.equal(matchesMulti([NONE_VALUE], null), true);
    assert.equal(matchesMulti([NONE_VALUE], "א"), false);
  });
});
