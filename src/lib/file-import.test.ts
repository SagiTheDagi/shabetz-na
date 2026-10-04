import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

import { toast } from "sonner";
import { isExcelFile, readImportFile, handleImportInput } from "./file-import";

const errors: string[] = [];
mock.method(toast, "error", (m: string) => { errors.push(m); return "id"; });

const evt = (file?: File) => {
  const input = { files: file ? [file] : [], value: "picked" };
  return { input, e: { target: input } as never };
};

describe("isExcelFile", () => {
  test("xlsx/xls any case; others false", () => {
    for (const n of ["a.xlsx", "a.XLS", "b.c.Xlsx"]) assert.equal(isExcelFile(new File([""], n)), true);
    for (const n of ["a.csv", "xlsx", "a.xlsx.csv", "a.xlsm"]) assert.equal(isExcelFile(new File([""], n)), false);
  });
});

describe("readImportFile", () => {
  const parsers = { excel: (b: ArrayBuffer) => `excel:${b.byteLength}`, text: (s: string) => `text:${s}` };
  test("routes by extension", async () => {
    assert.equal(await readImportFile(new File(["abc"], "a.xlsx"), parsers), "excel:3");
    assert.equal(await readImportFile(new File(["abc"], "a.csv"), parsers), "text:abc");
    assert.equal(await readImportFile(new File(["abc"], "a.txt"), parsers), "text:abc");
  });
});

describe("handleImportInput", () => {
  test("no file -> handler not called, input untouched", async () => {
    const { input, e } = evt();
    let called = false;
    await handleImportInput(e, async () => { called = true; });
    assert.equal(called, false);
    assert.equal(input.value, "picked");
  });
  test("clears input after success", async () => {
    const { input, e } = evt(new File(["x"], "a.csv"));
    await handleImportInput(e, async () => {});
    assert.equal(input.value, "");
  });
  test("handler throw -> error toast, input still cleared, no rejection", async () => {
    errors.length = 0;
    const { input, e } = evt(new File(["x"], "a.csv"));
    await handleImportInput(e, async () => { throw new Error("boom"); });
    assert.deepEqual(errors, ["שגיאה בקריאת הקובץ"]);
    assert.equal(input.value, "");
  });
});
