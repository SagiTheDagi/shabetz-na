// Headless smoke test. Needs a running server seeded with admin (npm run db:seed).
// Usage: BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... npm run test:e2e
// First time: npx playwright install chromium
import { chromium } from "playwright";
const B = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";
const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra="") => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name, extra); };

async function run(label, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type()==="error") errs.push("console: " + m.text()); });
  const r = await ctx.request.post(B + "/api/auth", { data: { worker_id: "admin", password: PASSWORD } });
  check(`${label} login`, r.ok(), String(r.status()));

  // workers list
  await page.goto(B + "/admin/workers");
  await page.waitForFunction(() => document.body.innerText.includes("מנהל מערכת"), null, { timeout: 15000 }).then(() => check(`${label} workers list renders`, true)).catch(() => check(`${label} workers list renders`, false));
  // eligibility
  await page.goto(B + "/admin/eligibility");
  await page.waitForFunction(() => !document.body.innerText.includes("טוען..."), null, { timeout: 15000 }).then(() => check(`${label} eligibility loads`, true)).catch(() => check(`${label} eligibility loads`, false));
  check(`${label} eligibility has content`, (await page.innerText("body")).includes("OFFICER") || (await page.innerText("body")).includes("משמרת"));
  // worker detail
  await page.goto(B + "/admin/workers/admin");
  await page.waitForFunction(() => !document.body.innerText.includes("טוען..."), null, { timeout: 15000 }).then(() => check(`${label} worker detail loads`, true)).catch(() => check(`${label} worker detail loads`, false));
  await page.goto(B + "/admin/workers/nope-zzz");
  await page.waitForSelector("text=עובד לא נמצא", { timeout: 15000 }).then(() => check(`${label} worker missing -> not found`, true)).catch(() => check(`${label} worker missing`, false));
  // justice
  await page.goto(B + "/admin/justice");
  await page.waitForFunction(() => !document.body.innerText.includes("טוען..."), null, { timeout: 15000 }).then(() => check(`${label} justice loads`, true)).catch(() => check(`${label} justice loads`, false));
  await page.screenshot({ path: `${process.env.E2E_OUT ?? "."}/${label}-justice.png` });
  // justice with API failure: must not hang on loading
  await page.route("**/api/justice-chart", r => r.fulfill({ status: 500, body: "{}" }));
  await page.goto(B + "/admin/justice");
  await page.waitForFunction(() => !document.body.innerText.includes("טוען..."), null, { timeout: 15000 }).then(() => check(`${label} justice 500 -> exits loading`, true)).catch(() => check(`${label} justice 500 -> exits loading`, false));
  await page.unroute("**/api/justice-chart");
  // justice update (POST) swaps data without loading flash
  await page.goto(B + "/admin/justice");
  await page.waitForFunction(() => !document.body.innerText.includes("טוען..."));
  const btn = page.getByRole("button", { name: /עדכן/ }).first();
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(1500); check(`${label} justice update click no crash`, !errs.some(e=>e.startsWith("pageerror"))); }
  const real = errs.filter(e => !/status of 500|favicon|hydrat|Download the React DevTools/i.test(e));
  check(`${label} no page/console errors`, real.length === 0, real.slice(0,3).join(" | "));
  await ctx.close();
}
await run("desktop", { width: 1280, height: 800 });
await run("mobile", { width: 390, height: 844 });
await browser.close();
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAIL");
if (!results.every(Boolean)) process.exitCode = 1;
