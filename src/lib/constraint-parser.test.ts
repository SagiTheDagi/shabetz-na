/**
 * Fixture tests for the constraint parser.
 *
 * Every sample below is a real "אילוצים" cell from a production Google Forms
 * export. They are the specification: if a change breaks one of these, the
 * change is wrong.
 *
 * Run: npm test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseConstraints, computeCoverage, type ParsedConstraints } from "./constraint-parser";
import { enumerateDates } from "./date-utils";

const Q3: { start_date: string; end_date: string } = {
  start_date: "2026-07-01",
  end_date: "2026-09-30",
};

/** Every calendar day in the quarter, standing in for real ShiftDate rows. */
const ALL_QUARTER_DAYS = enumerateDates(Q3.start_date, Q3.end_date);

function chipsOf(parsed: ParsedConstraints) {
  return parsed.blocks.flatMap((b) => b.chips);
}

function findChip(parsed: ParsedConstraints, matchedText: string) {
  const chip = chipsOf(parsed).find((c) => c.matchedText.replace(/\s+/g, "") === matchedText.replace(/\s+/g, ""));
  assert.ok(chip, `expected a chip matching "${matchedText}"`);
  return chip;
}

function hasFlag(parsed: ParsedConstraints, matchedText: string, kind: string) {
  return findChip(parsed, matchedText).flags.some((f) => f.kind === kind);
}

// ---------------------------------------------------------------------------

describe("sample 1 — single date, cross-month range, quarter overrun", () => {
  const text = `11.7 אירוע משפחתי 
30.7-3.8 חו"ל
21.8-13.10 חו"ל (חל"ת)`;

  const parsed = parseConstraints(text, Q3);

  it("finds all three date mentions", () => {
    assert.equal(chipsOf(parsed).length, 3);
  });

  it("resolves a bare D.M against the quarter year", () => {
    const chip = findChip(parsed, "11.7");
    assert.deepEqual(chip.dates, ["2026-07-11"]);
  });

  it("keeps the trailing reason text", () => {
    assert.equal(findChip(parsed, "11.7").reason, "אירוע משפחתי");
  });

  it("expands a range that crosses a month boundary", () => {
    const chip = findChip(parsed, "30.7-3.8");
    assert.deepEqual(chip.dates, [
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
    assert.equal(chip.spanDays, 5);
  });

  it("clamps a range that overruns the quarter and flags it", () => {
    const chip = findChip(parsed, "21.8-13.10");
    assert.equal(chip.rawEnd, "2026-10-13");
    assert.equal(chip.dates.at(-1), "2026-09-30");
    assert.ok(hasFlag(parsed, "21.8-13.10", "overruns_quarter"));
    assert.ok(hasFlag(parsed, "21.8-13.10", "very_long_range"));
  });
});

describe("sample 2 — header, whole month, implied-month ranges", () => {
  const text = `אלו התארכים בהם לא אוכל;
יולי לא יכול בכלל
13-15.8

10-13.9
20-30.9`;

  const parsed = parseConstraints(text, Q3);

  it("treats the trailing-semicolon line as a negative header", () => {
    assert.equal(parsed.blocks[0].headerText, "אלו התארכים בהם לא אוכל;");
    assert.equal(parsed.blocks[0].polarity, "unavailable");
    assert.equal(parsed.blocks[0].polarityDetected, true);
  });

  it("expands a bare month name to the whole month", () => {
    const july = chipsOf(parsed).find((c) => c.flags.some((f) => f.kind === "whole_month"));
    assert.ok(july);
    assert.equal(july.dates.length, 31);
    assert.equal(july.dates[0], "2026-07-01");
    assert.equal(july.dates.at(-1), "2026-07-31");
  });

  it("applies the right-hand month to a day-only range start", () => {
    assert.deepEqual(findChip(parsed, "13-15.8").dates, [
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
    ]);
    assert.deepEqual(findChip(parsed, "10-13.9").dates, [
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });

  it("splits into a new block after the blank line", () => {
    assert.ok(parsed.blocks.length >= 2);
  });
});

describe("sample 3 — comma-separated, overlapping ranges", () => {
  const text = `26.8, 9.9-13.9, 20-21.9, 9.9-26.9`;
  const parsed = parseConstraints(text, Q3);

  it("finds all four mentions on a single line", () => {
    assert.equal(chipsOf(parsed).length, 4);
  });

  it("unions overlapping ranges without duplicating dates", () => {
    // 9.9-13.9 is fully contained in 9.9-26.9
    assert.equal(parsed.allDates.filter((d) => d === "2026-09-10").length, 1);
  });

  it("covers the full union", () => {
    assert.ok(parsed.allDates.includes("2026-08-26"));
    assert.ok(parsed.allDates.includes("2026-09-20"));
    assert.ok(parsed.allDates.includes("2026-09-26"));
  });
});

describe("sample 4 — ' - ' as both range separator and reason separator", () => {
  const text = `1.7 - מבחן בתואר
1.7 - 3.7 - הגשת פרויקט בתואר
5.7 - 7.7 - מבחן בתואר
23.7 - 26.7 - מבחן בתואר
28.7 - 30.7 - מבחן בתואר
2.8 - 8.8 - נופש
7.9 - יום הולדת בת זוג
30.9 - יום הולדת`;

  const parsed = parseConstraints(text, Q3);

  it("finds all eight mentions", () => {
    assert.equal(chipsOf(parsed).length, 8);
  });

  it("reads a dash followed by prose as a reason, not a range", () => {
    const chip = chipsOf(parsed).find((c) => c.reason === "מבחן בתואר" && !c.isRange);
    assert.ok(chip);
    assert.deepEqual(chip.dates, ["2026-07-01"]);
  });

  it("reads a dash followed by a date as a range", () => {
    const chip = findChip(parsed, "1.7 - 3.7");
    assert.equal(chip.isRange, true);
    assert.deepEqual(chip.dates, ["2026-07-01", "2026-07-02", "2026-07-03"]);
    assert.equal(chip.reason, "הגשת פרויקט בתואר");
  });

  it("handles the last entry of the quarter", () => {
    assert.deepEqual(findChip(parsed, "30.9").dates, ["2026-09-30"]);
  });
});

describe("sample 5 — zero-padded, 'עד' ranges, out-of-quarter, vague month", () => {
  const text = `30.06 - מבחן
06.07 - מבחן
במהלך חודש יולי עדיף שלא, אילוץ צבאי שאי אפשר לרשום (ב"מ)
9.8 עד 3.9 - חול
20.9 עד 23.9 נופש קבע`;

  const parsed = parseConstraints(text, Q3);

  it("flags a date just outside the quarter and imports nothing for it", () => {
    const chip = findChip(parsed, "30.06");
    assert.equal(chip.rawStart, "2026-06-30");
    assert.deepEqual(chip.dates, []);
    assert.ok(hasFlag(parsed, "30.06", "outside_quarter"));
  });

  it("parses zero-padded DD.MM", () => {
    assert.deepEqual(findChip(parsed, "06.07").dates, ["2026-07-06"]);
  });

  it("parses a Hebrew 'עד' range", () => {
    const chip = findChip(parsed, "9.8 עד 3.9");
    assert.equal(chip.rawStart, "2026-08-09");
    assert.equal(chip.rawEnd, "2026-09-03");
    assert.equal(chip.spanDays, 26);
    assert.equal(chip.reason, "חול");
  });

  it("flags a 26-day range as long", () => {
    assert.ok(hasFlag(parsed, "9.8 עד 3.9", "long_range"));
  });

  it("routes a vague month reference to leftover instead of guessing", () => {
    assert.ok(parsed.leftover.some((l) => l.includes("במהלך חודש יולי")));
    assert.equal(
      chipsOf(parsed).some((c) => c.flags.some((f) => f.kind === "whole_month")),
      false
    );
  });
});

describe("sample 6 — mostly unparseable, must not invent data", () => {
  const text = `היי אחי אילוצים לרבעון הקרוב :

תקופת מבחנים ביולי, כל אוגוסט אני פנוי
עד ה10.9, (לאחר מכן תקופת מבחנים נוספת של סמסטר קיץ בשאר ספטמבר)`;

  const parsed = parseConstraints(text, Q3);

  it("does not emit rows for 'אני פנוי' (availability is the default state)", () => {
    assert.ok(parsed.leftover.some((l) => l.includes("פנוי")));
    const augustDates = parsed.allDates.filter((d) => d.startsWith("2026-08"));
    assert.deepEqual(augustDates, []);
  });

  it("flags an open-ended 'עד' phrasing for review", () => {
    assert.ok(hasFlag(parsed, "10.9", "open_ended"));
  });

  it("keeps unrecognised prose for the admin", () => {
    assert.ok(parsed.leftover.length > 0);
  });
});

describe("sample 7 — Hebrew calendar dates and a mid-text polarity flip", () => {
  const text = `תאריכים שלא אוכל בהם:
כ"ב-כ"ג תמוז (07-08/07)
כ"ז תמוז (12/07)
י"ב-י"ג אב (26-27/07)
י"ט-כ"א אב (02-04/08)
כ"ו-כ"ח אב (09-11/08)

אם במקרה מסתדר ממש אשמח לשמור ב:
י"ד-ט"ז תמוז (29/07-01/08)`;

  const parsed = parseConstraints(text, Q3);

  it("ignores the Hebrew calendar text and reads the Gregorian parenthetical", () => {
    assert.deepEqual(findChip(parsed, "07-08/07").dates, ["2026-07-07", "2026-07-08"]);
    assert.deepEqual(findChip(parsed, "12/07").dates, ["2026-07-12"]);
  });

  it("finds all six mentions", () => {
    assert.equal(chipsOf(parsed).length, 6);
  });

  it("scopes the first block as unavailable", () => {
    const negative = parsed.blocks.find((b) => b.headerText?.startsWith("תאריכים שלא"));
    assert.ok(negative);
    assert.equal(negative.polarity, "unavailable");
    assert.equal(negative.chips.length, 5);
  });

  it("detects the positive block and marks it prefer_work", () => {
    const positive = parsed.blocks.find((b) => b.headerText?.includes("אשמח לשמור"));
    assert.ok(positive, "expected a positive block");
    assert.equal(positive.polarity, "prefer_work");
    assert.equal(positive.polarityDetected, true);
    assert.equal(positive.chips.length, 1);
    assert.deepEqual(positive.chips[0].dates, [
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
    ]);
  });

  it("excludes prefer_work dates from the blocked coverage figure", () => {
    const coverage = computeCoverage(parsed, ALL_QUARTER_DAYS);
    // 2 + 1 + 2 + 3 + 3 = 11; the 4-day prefer_work range is excluded
    assert.equal(coverage.blocked, 11);
  });
});

describe("sample 8 — month names plus a vague qualifier", () => {
  const text = `לא יכול ביולי אוגוסט, ושבוע אחרון של ספטמבר`;
  const parsed = parseConstraints(text, Q3);

  it("expands the months stated before the vague qualifier", () => {
    assert.ok(parsed.allDates.includes("2026-07-15"));
    assert.ok(parsed.allDates.includes("2026-08-15"));
  });

  it("does not expand 'last week of September' into the whole month", () => {
    assert.equal(parsed.allDates.some((d) => d.startsWith("2026-09")), false);
  });

  it("preserves the line for the admin", () => {
    assert.ok(parsed.leftover.some((l) => l.includes("שבוע אחרון")));
  });
});

describe("sample 9 — recurring weekdays plus a clean date list", () => {
  const text = `ימים ראשון רביעי ושישי ימי לימודים מבין שזה המון אבל אשמח להתחשבות

אילוצים של מבחנים, חופשות מתוכננות וכו:
1.7
5-12.7
14.7
19.7
22.7
27.7
9-13.9
15-19.9
25-26.9`;

  const parsed = parseConstraints(text, Q3);

  it("routes recurring weekdays to standing_constraints, not per-date rows", () => {
    assert.deepEqual(parsed.recurringWeekdays, [0, 3, 5]); // Sun, Wed, Fri
    assert.ok(parsed.recurringText?.includes("ימי לימודים"));
  });

  it("does not explode the weekday rule into individual dates", () => {
    assert.equal(chipsOf(parsed).length, 9);
  });

  it("finds all nine date mentions", () => {
    assert.deepEqual(findChip(parsed, "1.7").dates, ["2026-07-01"]);
    assert.equal(findChip(parsed, "5-12.7").dates.length, 8);
    assert.equal(findChip(parsed, "9-13.9").dates.length, 5);
    assert.equal(findChip(parsed, "25-26.9").dates.length, 2);
  });

  it("uses the header line to scope polarity", () => {
    const block = parsed.blocks.find((b) => b.headerText?.startsWith("אילוצים"));
    assert.ok(block);
    assert.equal(block.polarity, "unavailable");
  });
});

// ---------------------------------------------------------------------------

describe("coverage reporting", () => {
  it("reports the share of quarter shifts blocked", () => {
    const parsed = parseConstraints(
      `11.7 אירוע משפחתי
30.7-3.8 חו"ל
21.8-13.10 חו"ל (חל"ת)`,
      Q3
    );
    const coverage = computeCoverage(parsed, ALL_QUARTER_DAYS);
    // 1 + 5 + (21.8 -> 30.9 = 41) = 47 of 92 days
    assert.equal(coverage.blocked, 47);
    assert.equal(coverage.total, 92);
    assert.equal(coverage.pct, 51);
  });

  it("counts only dates that have an actual shift", () => {
    const parsed = parseConstraints(`1.7 - 10.7`, Q3);
    const sparse = ["2026-07-01", "2026-07-05", "2026-08-20"];
    const coverage = computeCoverage(parsed, sparse);
    assert.equal(coverage.blocked, 2);
    assert.equal(coverage.total, 3);
  });
});

describe("sample 10 — day + Hebrew month name, onward phrasing", () => {
  const Q4: { start_date: string; end_date: string } = {
    start_date: "2026-10-01",
    end_date: "2026-12-31",
  };

  const text = `קקת מ9 בנובמבר והלאה
יום מכין ב20 באוקטובר
הכנה מה27 באוקטובר`;

  const parsed = parseConstraints(text, Q4);

  it("resolves a bare day+month-name mention to that exact date, not the whole month", () => {
    const oct20 = findChip(parsed, "ב20 באוקטובר");
    assert.deepEqual(oct20.dates, ["2026-10-20"]);
    assert.equal(oct20.flags.some((f) => f.kind === "whole_month"), false);
  });

  it("keeps two different days in the same month distinct", () => {
    const oct27 = findChip(parsed, "מה27 באוקטובר");
    assert.deepEqual(oct27.dates, ["2026-10-27"]);
  });

  it("anchors 'from X onward' to the stated date, flagged for admin review", () => {
    const chip = findChip(parsed, "מ9 בנובמבר");
    assert.deepEqual(chip.dates, ["2026-11-09"]);
    assert.ok(chip.flags.some((f) => f.kind === "open_ended"));
  });

  it("parses a day+month-name range across two named months", () => {
    const parsed2 = parseConstraints("מ-27 באוקטובר עד 3 בנובמבר", Q4);
    const chip = chipsOf(parsed2)[0];
    assert.equal(chip.rawStart, "2026-10-27");
    assert.equal(chip.rawEnd, "2026-11-03");
    assert.equal(chip.isRange, true);
  });

  it("parses a day-day range naming the month once", () => {
    const parsed2 = parseConstraints("27-29 באוקטובר", Q4);
    assert.deepEqual(chipsOf(parsed2)[0].dates, [
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
    ]);
  });
});

describe("sample 11 — numbered list glued onto dates", () => {
  const Q4: { start_date: string; end_date: string } = {
    start_date: "2026-10-01",
    end_date: "2026-12-31",
  };

  const text = `1.6.10 מברון
2.7-14.10 חופש חו"ל
3.21.10 חתונה
4.5.10 מברון
5.10.10 חתונה
6.26.11 מברון
7.2.12 חתונה`;

  const parsed = parseConstraints(text, Q4);

  it("strips the list number instead of reading it as part of the date", () => {
    assert.deepEqual(findChip(parsed, "6.10").dates, ["2026-10-06"]);
    assert.deepEqual(findChip(parsed, "21.10").dates, ["2026-10-21"]);
    assert.deepEqual(findChip(parsed, "5.10").dates, ["2026-10-05"]);
    assert.deepEqual(findChip(parsed, "10.10").dates, ["2026-10-10"]);
    assert.deepEqual(findChip(parsed, "26.11").dates, ["2026-11-26"]);
  });

  it("does not misread '7.2.12' as day 7 / month 2 (outside the quarter)", () => {
    const chip = findChip(parsed, "2.12");
    assert.deepEqual(chip.dates, ["2026-12-02"]);
    assert.equal(chip.flags.some((f) => f.kind === "outside_quarter"), false);
  });

  it("resolves a marker glued onto a RANGE too, using the confirmed markers around it", () => {
    // "2.7-14.10" alone has the same shape as a genuine "D.M-D.M" range (e.g.
    // "30.7-3.8"), so it isn't safe to strip in isolation — but markers 1, 3,
    // 4, 5, 6 elsewhere in this same text already confirm it's a numbered
    // list, and "2" slots exactly between confirmed 1 and 3.
    const chip = findChip(parsed, "7-14.10");
    assert.deepEqual(chip.dates, [
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
    ]);
    assert.equal(chip.flags.length, 0);
  });

  it("finds all seven mentions", () => {
    assert.equal(chipsOf(parsed).length, 7);
  });
});

describe("sample 11b — numbered list with a space (even doubled) after the dot", () => {
  // Real submission: "1. 6.10 ..." and even "3.  21.10 ..." (double space).
  // The date regexes already tolerate whitespace around their own
  // separators, so a plain "\d\." glued check isn't enough — the marker
  // must be stripped whether or not (and however much) whitespace follows.
  const Q4: { start_date: string; end_date: string } = {
    start_date: "2026-10-01",
    end_date: "2026-12-31",
  };

  const text = `1. 6.10 מבחן
2. 7-14.10 חופש חו"ל
3.  21.10 חתונה
4.  5.10 מבחן
5. 10.10 חתונה
5.  26.11 מבחן
6.  2.12 חתונה`;

  const parsed = parseConstraints(text, Q4);

  it("strips a single-space marker", () => {
    assert.deepEqual(findChip(parsed, "6.10").dates, ["2026-10-06"]);
    assert.deepEqual(findChip(parsed, "10.10").dates, ["2026-10-10"]);
  });

  it("also resolves the marker-glued-onto-a-range line via list context", () => {
    assert.deepEqual(findChip(parsed, "7-14.10").dates, [
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
    ]);
  });

  it("strips a double-space marker just as well", () => {
    assert.deepEqual(findChip(parsed, "21.10").dates, ["2026-10-21"]);
    assert.deepEqual(findChip(parsed, "5.10").dates, ["2026-10-05"]);
    assert.deepEqual(findChip(parsed, "26.11").dates, ["2026-11-26"]);
    assert.deepEqual(findChip(parsed, "2.12").dates, ["2026-12-02"]);
  });

  it("finds all seven mentions with nothing left over", () => {
    assert.equal(chipsOf(parsed).length, 7);
    assert.deepEqual(parsed.leftover, []);
  });
});

describe("sample 11c — a range's own day doesn't get mistaken for a marker", () => {
  it("leaves a genuine long range alone when it doesn't fit the confirmed sequence", () => {
    // Two confirmed markers (1, 2) establish list context, but this range's
    // leading day (21) is nowhere near that sequence, so it must NOT be
    // treated as a marker — it's a real (if unusually long) request.
    const Q4: { start_date: string; end_date: string } = {
      start_date: "2026-10-01",
      end_date: "2026-12-31",
    };
    const text = `1. 6.10 מבחן
2. 5.10 מבחן
21.8-13.10 חופש`;
    const parsed = parseConstraints(text, Q4);
    const chip = findChip(parsed, "21.8-13.10");
    assert.equal(chip.rawStart, "2026-08-21");
    assert.equal(chip.rawEnd, "2026-10-13");
  });
});

describe("sample 12 — a lone leading number is left as a real date", () => {
  it("does not strip '5.' from a single non-list '5.10' date", () => {
    const Q4: { start_date: string; end_date: string } = {
      start_date: "2026-10-01",
      end_date: "2026-12-31",
    };
    const parsed = parseConstraints("5.10 חופש", Q4);
    assert.deepEqual(parsed.allDates, ["2026-10-05"]);
  });

  it("does not corrupt a real multi-line list of plain ranges (no list numbering)", () => {
    // Regression: "25.10-3.11" and "12.11-22.11" each start with a two-digit
    // day immediately followed by a dot, the same shape a glued list marker
    // would have — they must be read as genuine ranges, not have their
    // leading day mistaken for a marker and stripped off.
    const Q4: { start_date: string; end_date: string } = {
      start_date: "2026-10-01",
      end_date: "2026-12-31",
    };
    const text = `25.10-3.11
5.11
12.11-22.11
26.11
16.12-21.12`;
    const parsed = parseConstraints(text, Q4);

    assert.equal(findChip(parsed, "25.10-3.11").rawStart, "2026-10-25");
    assert.equal(findChip(parsed, "25.10-3.11").rawEnd, "2026-11-03");

    assert.equal(findChip(parsed, "12.11-22.11").rawStart, "2026-11-12");
    assert.equal(findChip(parsed, "12.11-22.11").rawEnd, "2026-11-22");
  });
});

describe("edge cases", () => {
  it("returns an empty result for blank input", () => {
    const parsed = parseConstraints("   \n  \n", Q3);
    assert.deepEqual(parsed.blocks, []);
    assert.deepEqual(parsed.allDates, []);
  });

  it("flags a reversed range instead of emitting dates", () => {
    const parsed = parseConstraints("13.9-9.9", Q3);
    const chip = chipsOf(parsed)[0];
    assert.deepEqual(chip.dates, []);
    assert.ok(chip.flags.some((f) => f.kind === "reversed_range"));
  });

  it("rejects an impossible calendar date", () => {
    const parsed = parseConstraints("31.6 חופש", Q3);
    assert.deepEqual(parsed.allDates, []);
  });

  it("restricts output to supplied shift dates", () => {
    const parsed = parseConstraints("1.7-5.7", Q3, {
      shiftDates: ["2026-07-02", "2026-07-04"],
    });
    assert.deepEqual(parsed.allDates, ["2026-07-02", "2026-07-04"]);
  });

  it("honours an overridden default polarity", () => {
    const parsed = parseConstraints("11.7 אירוע", Q3, { defaultPolarity: "prefer_not_work" });
    assert.equal(parsed.blocks[0].polarity, "prefer_not_work");
    assert.equal(parsed.blocks[0].polarityDetected, false);
  });
});
