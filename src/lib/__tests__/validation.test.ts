import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateString, validateOptionalString, validateInteger, validateBoolean, ValidationError,
} from "../validation";

describe("validateString", () => {
  it("trims and returns", () => assert.equal(validateString("  שלום ", "שם"), "שלום"));
  it("rejects non-strings, empty and whitespace-only", () => {
    for (const v of [undefined, null, 5, {}, "", "   "]) {
      assert.throws(() => validateString(v, "שם"), ValidationError);
    }
  });
  it("names the field in the message", () => {
    assert.throws(() => validateString("", "קוד דרגה"), /קוד דרגה נדרש/);
  });
  it("enforces max length on the trimmed value", () => {
    assert.equal(validateString(" abc ", "x", 3), "abc");
    assert.throws(() => validateString("abcd", "x", 3), /ארוך מדי/);
  });
});

describe("validateOptionalString", () => {
  it("maps null/undefined/empty to null", () => {
    for (const v of [null, undefined, ""]) assert.equal(validateOptionalString(v, "x"), null);
  });
  it("still validates a present value", () => {
    assert.equal(validateOptionalString(" a ", "x"), "a");
    assert.throws(() => validateOptionalString("a".repeat(501), "x"), ValidationError);
    assert.throws(() => validateOptionalString(5, "x"), ValidationError);
  });
});

describe("validateInteger", () => {
  it("accepts integers and numeric strings", () => {
    assert.equal(validateInteger(3, "x"), 3);
    assert.equal(validateInteger(0, "x"), 0);
    assert.equal(validateInteger("7", "x"), 7);
    assert.equal(validateInteger(-2, "x"), -2);
  });
  it("rejects floats, NaN, junk, null", () => {
    for (const v of [1.5, NaN, "abc", null, undefined, {}, Infinity]) {
      assert.throws(() => validateInteger(v, "x"), ValidationError);
    }
  });
  it("rejects partially numeric strings", () => {
    for (const v of ["12abc", "1.5", "", "1e3", "0x10"]) {
      assert.throws(() => validateInteger(v, "x"), ValidationError, v);
    }
    assert.equal(validateInteger(" 12 ", "x"), 12);
  });
});

describe("validateBoolean", () => {
  it("truthy forms -> 1", () => {
    for (const v of [true, 1, "true"]) assert.equal(validateBoolean(v), 1);
  });
  it("falsy forms and unknowns -> 0", () => {
    for (const v of [false, 0, "false", undefined, null, "yes", 2]) assert.equal(validateBoolean(v), 0);
  });
});
