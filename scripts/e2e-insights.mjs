// Headless E2E for the insights assistant (desktop + 375px mobile).
// Creates its own "e2e" saved view via the API and deletes it at the end.
// Run it against a TEST database, not production.
// Usage: BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... node scripts/e2e-insights.mjs
// Optional: LIVE=1 also sends one real question to Claude (costs ~$0.002 and
// needs ANTHROPIC_API_KEY on the server).
import os from "os";
import path from "path";
import { chromium } from "playwright";
const B = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";
const LIVE = process.env.LIVE === "1";
const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : extra);
};

const seedCtx = await browser.newContext();
const req = seedCtx.request;
const loginOk = (await req.post(B + "/api/auth", { data: { worker_id: "admin", password: PASSWORD } })).ok();
check("login", loginOk);
if (!loginOk) {
  console.log("Aborting: admin login failed (check ADMIN_PASSWORD / BASE_URL)");
  await browser.close();
  process.exit(1);
}

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.request.post(B + "/api/auth", { data: { worker_id: "admin", password: PASSWORD } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  return { ctx, page, errs };
}
const noHScroll = (page) =>
  page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);

const created = [];
try {
  // ---- API ----
  const usage = await (await req.get(B + "/api/insights/usage")).json();
  check("usage: shape", typeof usage.cost_usd === "number" && usage.cap === 5 && /^\d{4}-\d{2}$/.test(usage.month), JSON.stringify(usage));
  console.log(`  assistant enabled on server: ${usage.enabled}`);

  const bad = await req.post(B + "/api/insights/chat", { data: { messages: [] } });
  check("chat: rejects empty thread", bad.status() === (usage.enabled ? 400 : 503), String(bad.status()));

  const guest = await browser.newContext();
  check("chat: guest 401", (await guest.request.post(B + "/api/insights/chat", { data: {} })).status() === 401);
  await guest.close();

  const view = await req.post(B + "/api/insights/saved", {
    data: {
      kind: "table",
      title: "e2e דרגות",
      question: "e2e",
      spec: { title: "e2e דרגות", columns: [{ key: "rank_id", label: "מזהה" }, { key: "name", label: "שם" }] },
      source: { tool: "list_reference", args: { kind: "ranks" } },
    },
  });
  check("saved: create", view.status() === 201, String(view.status()));
  const { insight_id } = await view.json();
  created.push(insight_id);
  const chartView = await req.post(B + "/api/insights/saved", {
    data: {
      kind: "chart",
      title: "e2e משמרות לעובד",
      question: "e2e",
      spec: { kind: "bar", title: "e2e", x: { key: "name", label: "עובד", type: "category" }, series: [{ key: "shifts", label: "משמרות" }, { key: "weekend_shifts", label: "סופ״ש" }] },
      source: { tool: "shifts_per_worker", args: { role: "any" } },
    },
  });
  check("saved: create chart", chartView.status() === 201, String(chartView.status()));
  created.push((await chartView.json()).insight_id);
  const tampered = await req.post(B + "/api/insights/saved", {
    data: { kind: "table", title: "x", spec: { title: "x" }, source: { tool: "run_readonly_sql", args: { sql: "SELECT * FROM Worker" } } },
  });
  check("saved: unsafe SQL source rejected", tampered.status() === 400, String(tampered.status()));
  const dataRes = await req.get(`${B}/api/insights/saved/${insight_id}/data`);
  const data = await dataRes.json();
  check("saved: re-run returns rows", dataRes.ok() && data.kind === "table" && data.spec.data.length > 0, JSON.stringify(data).slice(0, 200));

  // ---- UI: desktop + mobile ----
  for (const [label, viewport] of [["desktop", { width: 1280, height: 860 }], ["mobile", { width: 375, height: 760 }]]) {
    const { ctx, page, errs } = await newPage(viewport);

    await page.goto(B + "/admin/insights/saved");
    // The card shows its title while loading; wait for the re-run table itself.
    const table = page.locator("table").filter({ has: page.locator("th", { hasText: "מזהה" }) }).first();
    await table.locator("tbody tr").first().waitFor({ timeout: 15000 });
    const rows = await table.locator("tbody tr").count();
    check(`${label}: saved grid renders the re-run table`, rows === data.spec.data.length, `rows=${rows}`);
    const chart = page.locator("[data-slot='chart'] .recharts-surface").first();
    check(`${label}: saved chart renders`, await chart.waitFor({ timeout: 15000 }).then(() => true, () => false));
    check(`${label}: saved grid has no horizontal scroll`, await noHScroll(page));
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR ?? os.tmpdir(), `e2e-insights-saved-${label}.png`), fullPage: true }).catch(() => {});

    await page.goto(B + "/admin/insights");
    if (usage.enabled) {
      await page.getByText("שאל שאלה על נתוני השיבוץ").waitFor({ timeout: 15000 });
      check(`${label}: chat empty state`, true);
      check(`${label}: chat has no horizontal scroll`, await noHScroll(page));
      if (label === "desktop") {
        const navLink = page.locator("nav a[href='/admin/insights']");
        check("desktop: sidebar shows assistant", await navLink.waitFor({ timeout: 10000 }).then(() => true, () => false));
      } else {
        await page.goto(B + "/admin/more");
        await page.locator("main a[href='/admin/insights']").waitFor({ timeout: 10000 });
        check("mobile: /admin/more links the assistant", true);
        await page.goto(B + "/admin/insights");
        await page.getByText("שאל שאלה על נתוני השיבוץ").waitFor({ timeout: 15000 });
      }

      if (LIVE && label === "desktop") {
        await page.locator("textarea").fill("אילו דרגות יש במערכת? הצג אותן בטבלה.");
        await page.keyboard.press("Enter");
        check("live: stop button while running", await page.getByLabel("עצור").isVisible({ timeout: 5000 }).catch(() => false));
        await page.getByLabel("שלח").waitFor({ timeout: 60000 });
        const tables = await page.locator("table").count();
        const text = await page.locator("p.whitespace-pre-wrap").allInnerTexts();
        check("live: answer rendered a table", tables > 0, `tables=${tables} text=${text.join(" | ").slice(0, 200)}`);
        const after = await (await req.get(B + "/api/insights/usage")).json();
        check("live: usage recorded", after.cost_usd > usage.cost_usd, `${usage.cost_usd} → ${after.cost_usd}`);
      }
    } else {
      await page.getByText("העוזר אינו מוגדר בשרת").waitFor({ timeout: 15000 });
      check(`${label}: disabled notice`, true);
    }

    check(`${label}: no console errors`, errs.length === 0, errs.join("\n"));
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR ?? os.tmpdir(), `e2e-insights-${label}.png`), fullPage: false }).catch(() => {});
    await ctx.close();
  }
} finally {
  for (const id of created) {
    const del = await req.delete(`${B}/api/insights/saved/${id}`);
    check("cleanup: delete saved view", del.ok(), String(del.status()));
  }
  await seedCtx.close();
  await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
