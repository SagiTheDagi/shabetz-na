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
  DEFAULT_FILTERS,
  readFilters,
  writeFilters,
  applyFilters,
  activeFilterCount,
  toggleValue,
  filtersToQuery,
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

describe("readFilters / writeFilters", () => {
  it("round-trips all fields, incl. commas and repeated params", () => {
    const state = {
      search: "דני",
      statuses: ["exempt", "archived"] as const,
      whatsapp: "out" as const,
      ranks: ["r1", "r2"],
      branches: ["א, ב", NONE_VALUE],
      teams: ["צוות 1"],
    };
    const params = new URLSearchParams("worker=123");
    writeFilters({ ...state, statuses: [...state.statuses] }, params);
    assert.equal(params.get("worker"), "123");
    assert.equal(params.get("filter"), "no-whatsapp");
    assert.deepEqual(readFilters(params), { ...state, statuses: [...state.statuses] });
  });
  it("omits defaults from the URL", () => {
    const params = new URLSearchParams("status=active&branch=x");
    writeFilters(DEFAULT_FILTERS, params);
    assert.equal(params.toString(), "");
  });
  it("reads legacy dashboard link and dedupes", () => {
    const f = readFilters(new URLSearchParams("filter=no-whatsapp&branch=a&branch=a&rank="));
    assert.equal(f.whatsapp, "out");
    assert.deepEqual(f.branches, ["a"]);
    assert.deepEqual(f.ranks, []);
  });
});

describe("applyFilters / activeFilterCount", () => {
  const w = (o: Partial<Parameters<typeof applyFilters>[0][number]>) => ({
    worker_id: "1",
    name: "x",
    phone: null,
    branch: null,
    is_exempt: 0,
    ...o,
  });
  const workers = [
    w({ worker_id: "a", name: "Avi", branch: "B1", rank_id: "r1", in_whatsapp_group: 1 }),
    w({ worker_id: "b", name: "Beni", branch: "B2", is_exempt: 1 }),
    w({ worker_id: "c", name: "Chen", is_archived: 1 }),
  ];
  const ids = (f: Partial<typeof DEFAULT_FILTERS>) =>
    applyFilters(workers, { ...DEFAULT_FILTERS, ...f }).map((x) => x.worker_id);

  it("default hides archived", () => assert.deepEqual(ids({}), ["a", "b"]));
  it("status combos", () => {
    assert.deepEqual(ids({ statuses: ["archived"] }), ["c"]);
    assert.deepEqual(ids({ statuses: ["exempt", "archived"] }), ["b", "c"]);
  });
  it("branch / rank / whatsapp / search", () => {
    assert.deepEqual(ids({ branches: ["B2"] }), ["b"]);
    assert.deepEqual(ids({ ranks: ["r1"] }), ["a"]);
    assert.deepEqual(ids({ whatsapp: "out" }), ["b"]);
    assert.deepEqual(ids({ search: " ben " }), ["b"]);
  });
  it("counts non-default filters", () => {
    assert.equal(activeFilterCount(DEFAULT_FILTERS), 0);
    assert.equal(
      activeFilterCount({ ...DEFAULT_FILTERS, search: "x", whatsapp: "in", branches: ["a", "b"], statuses: ["active"] }),
      4
    );
  });
  it("toggleValue", () => {
    assert.deepEqual(toggleValue(["a"], "b"), ["a", "b"]);
    assert.deepEqual(toggleValue(["a", "b"], "a"), ["b"]);
  });
});

describe("filtersToQuery", () => {
  it("ignores status order/dupes and non-filter params", () => {
    const a = readFilters(new URLSearchParams("status=archived,exempt&worker=1"));
    const b = readFilters(new URLSearchParams("status=exempt,archived,exempt"));
    assert.equal(filtersToQuery(a), "status=archived%2Cexempt");
    assert.equal(filtersToQuery(DEFAULT_FILTERS), "");
    assert.deepEqual(new Set(a.statuses), new Set(b.statuses));
  });
  it("default statuses are not shared/mutable", () => {
    const f = parseStatuses(null);
    f.push("archived");
    assert.deepEqual(parseStatuses(null), ["active", "exempt"]);
  });
});
