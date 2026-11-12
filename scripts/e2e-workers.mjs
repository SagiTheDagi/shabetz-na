// Headless E2E for /admin/workers filters + URL sync (desktop & mobile).
// Creates/updates its own "e2e-*" workers via the API and archives them at the end.
// Only those workers are asserted on, but run it against a TEST database, not production.
// Usage: BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... node scripts/e2e-workers.mjs
// Optional: THROTTLE=6 (CPU slowdown factor) to widen race windows.
import { chromium } from "playwright";
const B = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";
const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : extra);
};
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// ---- seed ----
const ID = { w0: "e2e-w0", w1: "e2e-w1", w2: "e2e-w2", w3: "e2e-w3", w4: "e2e-w4", w5: "e2e-w5" };
// "e2e" prefix keeps names distinct from real data; searches below use the Hebrew part
const NAMES = { w0: "e2e אורי אפס", w1: "e2e אבי אלפא", w2: "e2e בני בטא", w3: "e2e גדי גמא", w4: "e2e דני דלתא", w5: "e2e הדר הא" };
const seedCtx = await browser.newContext();
const req = seedCtx.request;
const api = {
  get: (p) => req.get(B + p),
  post: (p, o) => req.post(B + p, o),
  patch: (p, o) => req.patch(B + p, o),
  dispose: () => seedCtx.close(),
};
const loginOk = (await api.post("/api/auth", { data: { worker_id: "admin", password: PASSWORD } })).ok();
check("login", loginOk);
if (!loginOk) {
  console.log("Aborting: admin login failed (check ADMIN_PASSWORD / BASE_URL)");
  await browser.close();
  process.exit(1);
}
const ranks = (await (await api.get("/api/ranks")).json()).map((r) => r.rank_id);
const [R0, R1] = [ranks[0], ranks[1] ?? ranks[0]];
const SEED = {
  w0: { rank_id: R0, is_exempt: 0, is_archived: 0, branch: null, team: null, in_whatsapp_group: 0 },
  w1: { rank_id: R0, is_exempt: 0, is_archived: 0, branch: "ענף א", team: "צוות 1", in_whatsapp_group: 1 },
  w2: { rank_id: R1, is_exempt: 1, is_archived: 0, branch: "ענף ב", team: null, in_whatsapp_group: 0 },
  w3: { rank_id: R0, is_exempt: 0, is_archived: 1, branch: "ענף א", team: "צוות 2", in_whatsapp_group: 0 },
  w4: { rank_id: R0, is_exempt: 1, is_archived: 1, branch: null, team: null, in_whatsapp_group: 1 },
  w5: { rank_id: R0, is_exempt: 0, is_archived: 0, branch: "ענף, עם פסיק", team: null, in_whatsapp_group: 0 },
};
const idsFromText = (texts) =>
  Object.entries(NAMES).filter(([, n]) => texts.some((t) => t.includes(n))).map(([k]) => k);

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.request.post(B + "/api/auth", { data: { worker_id: "admin", password: PASSWORD } });
  const page = await ctx.newPage();
  if (process.env.THROTTLE) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.THROTTLE) });
  }
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  return { ctx, page, errs };
}
const desktopRows = async (page) => idsFromText(await page.locator("tbody tr").allInnerTexts());
const mobileRows = async (page) => idsFromText(await page.locator('a[href^="/admin/workers/"]').allInnerTexts());
const params = (page) => new URL(page.url()).searchParams;
async function expectRows(page, getRows, expected, name) {
  let rows = [];
  for (let i = 0; i < 30; i++) {
    rows = await getRows(page);
    if (sameSet(rows, expected)) break;
    await page.waitForTimeout(100);
  }
  check(name, sameSet(rows, expected), `got ${JSON.stringify(rows)} want ${JSON.stringify(expected)}`);
}
const statusGroup = (page) => page.locator("div.overflow-hidden").filter({ has: page.locator("button", { hasText: /^ארכיון/ }) });
const statusBtn = (page, label) => statusGroup(page).locator("button", { hasText: new RegExp(`^${label}`) });

try {
for (const [k, f] of Object.entries(SEED)) {
  await api.post("/api/workers", { data: { worker_id: ID[k], name: NAMES[k], rank_id: f.rank_id } }); // 409 if exists
  const r = await api.patch(`/api/workers/${ID[k]}`, { data: { name: NAMES[k], ...f, exemption_reason: f.is_exempt ? "e2e" : null } });
  if (!r.ok()) check(`seed ${k}`, false, await r.text());
}

// ---------------- Desktop ----------------
{
  const { ctx, page, errs } = await newPage({ width: 1280, height: 800 });
  await page.goto(B + "/admin/workers");
  await page.waitForSelector("tbody tr");
  await expectRows(page, desktopRows, ["w0", "w1", "w2", "w5"], "D default = active+exempt");
  check("D default URL has no filter params", [...params(page).keys()].length === 0, page.url());

  await statusBtn(page, "ארכיון").click();
  await expectRows(page, desktopRows, ["w0", "w1", "w2", "w3", "w4", "w5"], "D add archived → all");
  await statusBtn(page, "פטור").click(); // all selected → isolate exempt
  await expectRows(page, desktopRows, ["w2"], "D only exempt (archived exempt excluded)");
  check("D URL status=exempt", params(page).get("status") === "exempt", page.url());
  await statusBtn(page, "ארכיון").click();
  await expectRows(page, desktopRows, ["w2", "w3", "w4"], "D exempt+archived");
  await statusBtn(page, "הכל").click();
  await statusBtn(page, "פעיל").click();
  await expectRows(page, desktopRows, ["w0", "w1", "w5"], "D only active");

  // branch with comma
  await page.locator("button", { hasText: /^ענף/ }).first().click();
  await page.getByRole("menuitemcheckbox", { name: "ענף, עם פסיק" }).click();
  await page.keyboard.press("Escape");
  await expectRows(page, desktopRows, ["w5"], "D branch with comma");
  check("D URL branch round-trip", params(page).getAll("branch").join("|") === "ענף, עם פסיק", page.url());
  await page.reload();
  await page.waitForSelector("tbody tr");
  await expectRows(page, desktopRows, ["w5"], "D reload keeps status+branch");

  // ללא ענף + team
  await page.goto(B + "/admin/workers?status=active,exempt,archived&branch=__none__");
  await page.waitForSelector("tbody tr");
  await expectRows(page, desktopRows, ["w0", "w4"], "D 'no branch' filter");
  await page.goto(B + "/admin/workers?status=active,exempt,archived&team=" + encodeURIComponent("צוות 2"));
  await page.waitForSelector("tbody tr");
  await expectRows(page, desktopRows, ["w3"], "D team filter from URL");
  await page.goto(B + "/admin/workers?rank=" + encodeURIComponent(R1));
  await page.waitForSelector("tbody tr");
  await expectRows(page, desktopRows, ["w2"], "D rank filter from URL");
  await page.goto(B + "/admin/workers?branch=" + encodeURIComponent("ענף שלא קיים"));
  await page.waitForTimeout(800);
  await expectRows(page, desktopRows, [], "D stale branch → empty");
  await page.locator("button", { hasText: /^ענף/ }).first().click();
  const staleItem = page.getByRole("menuitemcheckbox", { name: "ענף שלא קיים" });
  check("D stale branch visible in dropdown", await staleItem.waitFor({ timeout: 3000 }).then(() => true, () => false));
  await staleItem.click();
  await page.keyboard.press("Escape");
  await expectRows(page, desktopRows, ["w0", "w1", "w2", "w5"], "D unchecking stale branch restores list");
  await page.keyboard.press("Escape");

  // search: list + URL update on every keystroke
  await page.goto(B + "/admin/workers");
  await page.waitForSelector("tbody tr");
  const search = page.locator('input[placeholder^="חיפוש"]');
  await search.click();
  await search.pressSequentially("בני", { delay: 30 });
  await page.waitForTimeout(100);
  check("D search in URL immediately", params(page).get("search") === "בני", page.url());
  await expectRows(page, desktopRows, ["w2"], "D search filters list");
  // very fast typing: no lost/reordered characters from URL echoes
  await search.fill("");
  await search.pressSequentially("אבגדהוזחטיכל", { delay: 0 });
  await page.waitForTimeout(500);
  check("D fast typing keeps all chars", (await search.inputValue()) === "אבגדהוזחטיכל", await search.inputValue());
  check("D fast typing URL matches input", params(page).get("search") === "אבגדהוזחטיכל", page.url());
  // typing right after a status toggle
  await search.fill("");
  await statusBtn(page, "ארכיון").click();
  await search.pressSequentially("גדי", { delay: 0 });
  await page.waitForTimeout(500);
  check("D type right after toggle keeps both", (await search.inputValue()) === "גדי" && params(page).has("status"), page.url());
  await expectRows(page, desktopRows, ["w3"], "D toggle+search rows");
  await search.fill("");

  // clear filters, including pending typing
  await statusBtn(page, "ארכיון").click();
  await search.pressSequentially("x", { delay: 0 });
  await page.getByText("נקה סינון").click();
  await page.waitForTimeout(700);
  check("D clear: input empty", (await search.inputValue()) === "", await search.inputValue());
  check("D clear: URL clean", [...params(page).keys()].length === 0, page.url());
  await expectRows(page, desktopRows, ["w0", "w1", "w2", "w5"], "D clear → default rows");

  // worker selection derived from URL
  await page.locator("tbody tr", { hasText: NAMES.w1 }).click();
  await page.waitForTimeout(300);
  check("D select row → ?worker=" + ID.w1, params(page).get("worker") === ID.w1, page.url());
  await statusBtn(page, "ארכיון").click();
  await page.waitForTimeout(300);
  check("D filter change keeps worker param", params(page).get("worker") === ID.w1 && params(page).has("status"), page.url());
  await page.goto(B + "/admin/workers?worker=nope");
  await page.waitForSelector("tbody tr");
  await page.waitForTimeout(500);
  check("D unknown worker param removed", !params(page).has("worker"), page.url());
  await page.goto(B + "/admin/workers?worker=" + ID.w2);
  await page.waitForSelector("tbody tr");
  await page.waitForTimeout(500);
  check("D deep-link worker opens panel", params(page).get("worker") === ID.w2 && (await page.locator("tbody tr.bg-white\\/\\[0\\.04\\]").count()) === 1);

  // external client-side navigation to same route resets filters
  await page.goto(B + "/admin/workers?branch=" + encodeURIComponent("ענף א"));
  await page.waitForSelector("tbody tr");
  await expectRows(page, desktopRows, ["w1"], "D branch א");
  const navLink = page.locator('a[href="/admin/workers"]').first();
  if (await navLink.count()) {
    await navLink.click();
    await page.waitForTimeout(800);
    check("D nav link → URL clean", [...params(page).keys()].length === 0, page.url());
    await expectRows(page, desktopRows, ["w0", "w1", "w2", "w5"], "D nav link resets filters");
    await page.locator("button", { hasText: /^ענף/ }).first().click();
    check("D nav link resets branch dropdown", await page.locator("button", { hasText: /^ענף\s*\(/ }).count() === 0);
    await page.keyboard.press("Escape");
  } else check("D nav link exists", false);

  // rapid toggle on/off (net no-op), then a real filter, then nav link must still reset
  await page.goto(B + "/admin/workers");
  await page.waitForSelector("tbody tr");
  await page.locator("button", { hasText: /^דרגה/ }).first().click();
  const aao = page.getByRole("menuitemcheckbox").first();
  await aao.click();
  await aao.click();
  await page.keyboard.press("Escape");
  await statusBtn(page, "ארכיון").click();
  await page.waitForTimeout(300);
  await page.locator('a[href="/admin/workers"]').first().click();
  await page.waitForTimeout(800);
  await expectRows(page, desktopRows, ["w0", "w1", "w2", "w5"], "D rapid toggle then nav link resets");

  // rapid worker clicks end on the last one; panel opens instantly
  await page.locator("tbody tr", { hasText: NAMES.w1 }).click();
  const instant = await page.locator("tbody tr.bg-white\\/\\[0\\.04\\]", { hasText: NAMES.w1 }).count();
  check("D row selection highlight is instant", instant === 1);
  await page.locator("tbody tr", { hasText: NAMES.w5 }).click();
  await page.waitForTimeout(600);
  const sel = await page.locator("tbody tr.bg-white\\/\\[0\\.04\\]").allInnerTexts();
  check("D rapid A→B selection ends on B", params(page).get("worker") === ID.w5 && sel.length === 1 && sel[0].includes(NAMES.w5), page.url() + " " + JSON.stringify(sel));

  // dashboard link ?filter=no-whatsapp
  await page.goto(B + "/admin/workers?filter=no-whatsapp");
  await page.waitForSelector("tbody tr");
  await expectRows(page, desktopRows, ["w0", "w2", "w5"], "D legacy ?filter=no-whatsapp");

  // clicked selection is kept (not redirected) when the window shrinks to mobile
  await page.goto(B + "/admin/workers");
  await page.waitForSelector("tbody tr");
  await page.locator("tbody tr", { hasText: NAMES.w1 }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  check("D click-select then shrink: stays on list", new URL(page.url()).pathname === "/admin/workers", page.url());
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForSelector("tbody tr");
  check("D …and selection survives back to desktop", params(page).get("worker") === ID.w1, page.url());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(`a[href="/admin/workers/${ID.w5}"]`).click();
  await page.waitForURL((u) => u.pathname === "/admin/workers/" + ID.w5, { timeout: 8000 }).catch(() => {});
  await page.goBack();
  await page.waitForTimeout(1000);
  check("D kept selection doesn't redirect on mobile Back", new URL(page.url()).pathname === "/admin/workers", page.url());
  await page.setViewportSize({ width: 1280, height: 800 });

  // layout switch keeps filters + pending text
  await page.goto(B + "/admin/workers?status=archived");
  await page.waitForSelector("tbody tr");
  await expectRows(page, desktopRows, ["w3", "w4"], "D archived only");
  await page.locator('input[placeholder^="חיפוש"]').pressSequentially("גדי", { delay: 0 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForSelector('a[href^="/admin/workers/"]');
  await page.waitForTimeout(600);
  await expectRows(page, mobileRows, ["w3"], "D→M switch keeps status + typed search");
  check("D→M search input value kept", (await page.locator('input[placeholder^="חיפוש"]').inputValue()) === "גדי");

  const real = errs.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  check("D no page/console errors", real.length === 0, real.slice(0, 3).join(" | "));
  await ctx.close();
}

// ---------------- Mobile ----------------
{
  const { ctx, page, errs } = await newPage({ width: 390, height: 844 });
  await page.goto(B + "/admin/workers");
  await page.waitForSelector('a[href^="/admin/workers/"]');
  await expectRows(page, mobileRows, ["w0", "w1", "w2", "w5"], "M default = active+exempt");
  await page.goto(B + "/admin/workers?status=archived");
  await page.waitForSelector('a[href^="/admin/workers/"]');
  await expectRows(page, mobileRows, ["w3", "w4"], "M URL status=archived (same as desktop)");
  await page.goto(B + "/admin/workers?filter=in-whatsapp");
  await page.waitForSelector('a[href^="/admin/workers/"]');
  await expectRows(page, mobileRows, ["w1"], "M in-whatsapp filter");
  check("M badge counts in-whatsapp", (await page.locator("button", { hasText: /^סינון · 1$/ }).count()) === 1);

  // sheet: branch chip, status chips, reset
  await page.goto(B + "/admin/workers");
  await page.waitForSelector('a[href^="/admin/workers/"]');
  await page.locator('input[placeholder^="חיפוש"]').fill("א");
  await page.waitForTimeout(500);
  await page.locator("button", { hasText: /^סינון/ }).click();
  await page.locator("button", { hasText: /^ענף א$/ }).click();
  await page.locator("button", { hasText: /^ארכיון$/ }).click();
  await expectRows(page, mobileRows, ["w1", "w3"], "M sheet branch+archived");
  check("M URL updated from sheet", params(page).getAll("branch")[0] === "ענף א" && params(page).has("status"), page.url());
  await page.locator("button", { hasText: /^איפוס$/ }).click();
  await page.waitForTimeout(500);
  check("M reset clears search + URL", [...params(page).keys()].length === 0 && (await page.locator('input[placeholder^="חיפוש"]').inputValue()) === "", page.url());

  // ?worker= deep link on mobile opens the worker page; Back returns to the list without looping
  await page.goto(B + "/admin/workers?worker=" + ID.w1);
  await page.waitForURL((u) => u.pathname === "/admin/workers/" + ID.w1, { timeout: 8000 }).catch(() => {});
  check("M ?worker= opens worker page", new URL(page.url()).pathname === "/admin/workers/" + ID.w1, page.url());
  await page.goBack();
  await page.waitForTimeout(1000);
  check("M Back returns to list without ?worker", new URL(page.url()).pathname === "/admin/workers" && !params(page).has("worker"), page.url());

  // M→D switch
  await page.goto(B + "/admin/workers?status=exempt");
  await page.waitForSelector('a[href^="/admin/workers/"]');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForSelector("tbody tr");
  await expectRows(page, desktopRows, ["w2"], "M→D switch keeps filters");

  const real = errs.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  check("M no page/console errors", real.length === 0, real.slice(0, 3).join(" | "));
  await ctx.close();
}

} finally {
  // ---- cleanup: archive the e2e workers (also on crash, so they never stay in the rotation) ----
  for (const id of Object.values(ID)) await api.patch(`/api/workers/${id}`, { data: { is_archived: 1 } }).catch(() => {});
  await api.dispose().catch(() => {});
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} FAIL / ${results.length}` : `ALL PASS (${results.length})`);
if (failed) process.exitCode = 1;
