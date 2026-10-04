// Headless test for the 3 import UIs using generated fixtures (python3 scripts/gen-fixtures.py).
// Usage: BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... node scripts/e2e-imports.mjs
import { chromium } from "playwright";
import path from "node:path";
const B = process.env.BASE_URL ?? "http://localhost:3000";
const FX = path.resolve(import.meta.dirname, "../src/lib/__tests__/fixtures");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|hydrat|status of/i.test(m.text())) errs.push(m.text()); });
let ok = true;
const check = (n, v, x = "") => { if (!v) ok = false; console.log(v ? "PASS" : "FAIL", n, x); };
const seen = (t) => page.getByText(t).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);

const r = await ctx.request.post(B + "/api/auth", { data: { worker_id: "admin", password: process.env.ADMIN_PASSWORD ?? "admin123" } });
check("login", r.ok());

async function upload(file, tab, expectText, label) {
  if (tab === "workers") {
    await page.goto(B + "/admin/workers");
    await page.getByRole("button", { name: "ייבוא עובדים" }).click();
  } else {
    await page.goto(B + "/admin/settings");
    await page.getByRole("tab", { name: tab }).click();
  }
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles(path.join(FX, file));
  check(`${label}: ${file}`, await seen(expectText));
  check(`${label}: input cleared`, (await input.inputValue()) === "");
}

await upload("workers.xlsx", "workers", "נמצאו 4 עובדים", "workers xlsx");
await upload("workers.csv", "workers", "נמצאו 4 עובדים", "workers csv");
await upload("workers-empty.xlsx", "workers", "לא נמצאו עובדים בקובץ", "workers empty");
// same file twice in a row must re-trigger (input cleared)
const wi = page.locator('input[type="file"]').first();
await wi.setInputFiles(path.join(FX, "workers-empty.xlsx"));
check("workers re-pick same file", await seen("לא נמצאו עובדים בקובץ"));

await upload("shift-dates.xlsx", "תאריכי משמרות", "נמצאו 2 גיליונות עם 7 תאריכים", "dates xlsx");
await upload("shift-dates.csv", "תאריכי משמרות", "נמצאו 3 תאריכים", "dates csv");
await upload("form-responses.xlsx", "ייבוא אילוצים", "נמצאו 3 תגובות", "form xlsx");
await upload("form-responses.csv", "ייבוא אילוצים", "נמצאו 2 תגובות", "form csv");
await upload("workers-empty.xlsx", "ייבוא אילוצים", "לא נמצאו שורות בקובץ", "form empty");
await page.screenshot({ path: process.env.E2E_OUT ? `${process.env.E2E_OUT}/imports.png` : "imports.png" });
check("no page/console errors", errs.length === 0, errs.slice(0, 3).join(" | "));
await browser.close();
console.log(ok ? "ALL PASS" : "SOME FAIL");
process.exitCode = ok ? 0 : 1;
