/**
 * Browser checks against a running dev server + local Supabase stack.
 *
 * Playwright is deliberately not a project dependency (it downloads ~100MB of
 * browser), so install it on demand:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *
 * Then, from the project root:
 *
 *   npm run db:reset
 *   npm run db:seed > /tmp/seed.json
 *   node supabase/_localtest/mint-session.mjs anish.e2e@example.com > /tmp/cookies-anish.json
 *   node supabase/_localtest/mint-session.mjs nav.e2e@example.com   > /tmp/cookies-nav.json
 *   npm run dev
 *   node supabase/_localtest/ui/splits.mjs
 *
 * Override SEED_FILE, COOKIE_DIR and SHOT_DIR if /tmp isn't where you put them.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const COOKIE_DIR = process.env.COOKIE_DIR ?? "/tmp";

const BASE = "http://localhost:3000";
const room = JSON.parse(readFileSync(process.env.SEED_FILE ?? "/tmp/seed.json", "utf8")).roomId;
let pass = 0; const fails = []; const errs = [];
const check = (l, ok, d = "") => ok
  ? (pass++, console.log(`  ok  ${l}`))
  : (fails.push(`${l}${d ? " — " + d : ""}`), console.log(`FAIL  ${l}${d ? " — " + d : ""}`));


const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/** Ground truth from the database, so assertions don't hardcode arithmetic. */
async function dbBalances() {
  const res = await fetch("http://127.0.0.1:54321/rest/v1/rpc/room_balances", {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_room_id: room }),
  });
  return res.json();
}
const money = (c) => `$${(Math.abs(c) / 100).toFixed(2)}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 430, height: 920 } });
await ctx.addCookies(JSON.parse(readFileSync(`${COOKIE_DIR}/cookies-anish.json`, "utf8")));
const page = await ctx.newPage();
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });

await page.goto(`${BASE}/rooms/${room}`, { waitUntil: "networkidle" });

console.log("\n— editing an existing expense prefills the form —");
await page.getByText("Internet bill").click();
await page.waitForTimeout(800);
check("edit dialog opens", await page.getByText("Edit expense").isVisible());
check("description prefilled",
  (await page.getByLabel("What was it for?").inputValue()) === "Internet bill");
check("amount prefilled",
  (await page.getByLabel("Amount").inputValue()) === "45.00",
  await page.getByLabel("Amount").inputValue());
check("reopens in the mode it was created in",
  (await page.getByRole("button", { name: /Exact amounts/ }).first().getAttribute("aria-pressed")) === "true");
const shares = page.locator('input[id^="share-"]');
check("exact shares prefilled 20/15/10",
  (await shares.nth(0).inputValue()) === "20.00" &&
  (await shares.nth(1).inputValue()) === "15.00" &&
  (await shares.nth(2).inputValue()) === "10.00",
  `${await shares.nth(0).inputValue()}/${await shares.nth(1).inputValue()}/${await shares.nth(2).inputValue()}`);
check("payer prefilled to Nav",
  (await page.getByRole("button", { name: /Nav/ }).first().getAttribute("aria-pressed")) === "true");
check("delete is offered when editing",
  await page.getByRole("button", { name: "Delete" }).isVisible());

console.log("\n— editing recomputes balances —");
await page.getByLabel("Amount").fill("60.00");
await page.waitForTimeout(400);
check("changing the total invalidates the old shares",
  (await page.innerText("body")).includes("still to assign"));
await shares.nth(0).fill("35.00");
await page.waitForTimeout(400);
const saveEdit = page.getByRole("button", { name: "Save" });
check("save enabled once it balances again", await saveEdit.isEnabled());
await saveEdit.click();
await page.waitForTimeout(1500);
check("edited amount shows in the list",
  (await page.innerText("body")).includes("$60.00"),
  (await page.innerText("body")).slice(0, 300));

await page.goto(`${BASE}/rooms/${room}/balances`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const bal = await page.innerText("body");
const dbAfterEdit = await dbBalances();
check("database balances still net to zero",
  dbAfterEdit.reduce((s, b) => s + b.net_cents, 0) === 0,
  JSON.stringify(dbAfterEdit.map((b) => b.net_cents)));
check("every net balance from the database is shown in the UI",
  dbAfterEdit.every((b) => bal.includes(money(b.net_cents))),
  `db=${dbAfterEdit.map((b) => money(b.net_cents)).join(",")}`);

console.log("\n— percentage mode —");
await page.goto(`${BASE}/rooms/${room}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Add expense" }).last().click();
await page.waitForTimeout(600);
await page.getByLabel("What was it for?").fill("Utilities");
await page.getByLabel("Amount").fill("100.00");
await page.getByRole("button", { name: /Percentages/ }).first().click();
await page.waitForTimeout(400);
const pcts = page.locator('input[id^="share-"]');
await pcts.nth(0).fill("50");
await pcts.nth(1).fill("30");
await page.waitForTimeout(400);
check("percent mode reports the remaining 20%",
  /20% left to assign/.test(await page.innerText("body")),
  (await page.innerText("body")).match(/[\d.]+% (left|over)[^\n]*/)?.[0] ?? "none");
await pcts.nth(2).fill("20");
await page.waitForTimeout(400);
check("percent mode previews dollar shares",
  (await page.innerText("body")).includes("$50.00"));
const addBtn = page.getByRole("button", { name: "Add expense" }).last();
check("save enabled at exactly 100%", await addBtn.isEnabled());
await pcts.nth(2).fill("25");
await page.waitForTimeout(400);
check("save blocked over 100%", await addBtn.isDisabled());
check("says how far over", /5% over 100%/.test(await page.innerText("body")));
await pcts.nth(2).fill("20");
await page.waitForTimeout(400);
await addBtn.click();
await page.waitForTimeout(1500);
check("percentage expense saved", (await page.innerText("body")).includes("Utilities"));

console.log("\n— personal expense moves nobody's balance —");
await page.goto(`${BASE}/rooms/${room}/balances`, { waitUntil: "networkidle" });
const netsBefore = (await dbBalances()).map((b) => `${b.user_id}:${b.net_cents}`).sort().join(",");
await page.goto(`${BASE}/rooms/${room}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Add expense" }).last().click();
await page.waitForTimeout(600);
await page.getByLabel("What was it for?").fill("My own coffee");
await page.getByLabel("Amount").fill("6.00");
await page.getByRole("button", { name: /Just me/ }).first().click();
await page.waitForTimeout(400);
check("personal mode explains itself",
  /doesn.t change anyone.s\s*balance/i.test(await page.innerText("body")));
await page.getByRole("button", { name: "Add expense" }).last().click();
await page.waitForTimeout(1500);
check("personal expense logged", (await page.innerText("body")).includes("My own coffee"));
check("marked as not split", (await page.innerText("body")).includes("not split"));
await page.goto(`${BASE}/rooms/${room}/balances`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const netsAfter = (await dbBalances()).map((b) => `${b.user_id}:${b.net_cents}`).sort().join(",");
// A personal expense does raise that person's "paid" and "share" totals; what
// must not move is anyone's net position.
check("no net balance moved", netsBefore === netsAfter, `${netsBefore} -> ${netsAfter}`);
const shownAfter = await page.innerText("body");
check("UI agrees with the database after a personal expense",
  (await dbBalances()).every((b) => shownAfter.includes(money(b.net_cents))));

console.log("\n— deleting an expense —");
await page.goto(`${BASE}/rooms/${room}`, { waitUntil: "networkidle" });
await page.getByText("My own coffee").click();
await page.waitForTimeout(700);
await page.getByRole("button", { name: "Delete" }).click();
await page.waitForTimeout(1500);
check("expense removed from the list",
  !(await page.innerText("body")).includes("My own coffee"));

console.log(`\n${"=".repeat(60)}`);
console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log("  - " + f);
const real = errs.filter((e) => !/favicon/i.test(e));
console.log(real.length ? "\nconsole errors:\n  " + real.slice(0, 8).join("\n  ") : "\nno console errors");
console.log("=".repeat(60));
await browser.close();
process.exit(fails.length === 0 && real.length === 0 ? 0 : 1);
