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
 *   node supabase/_localtest/ui/flows.mjs
 *
 * Override SEED_FILE, COOKIE_DIR and SHOT_DIR if /tmp isn't where you put them.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const COOKIE_DIR = process.env.COOKIE_DIR ?? "/tmp";

const BASE = "http://localhost:3000";
const OUT = process.env.SHOT_DIR ?? "/tmp/shots";
const cookiesFor = (email) =>
  JSON.parse(readFileSync(`${COOKIE_DIR}/cookies-${email}.json`, "utf8"));

let pass = 0;
const fails = [];
const consoleErrors = [];

function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`  ok  ${label}`); }
  else { fails.push(`${label}${detail ? " — " + detail : ""}`); console.log(`FAIL  ${label}${detail ? " — " + detail : ""}`); }
}

const browser = await chromium.launch();

async function session(email, label) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 920 } });
  await ctx.addCookies(cookiesFor(email));
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`[${label}] ${m.text()}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
  return page;
}

const anish = await session("anish", "anish");
const nav = await session("nav", "nav");

console.log("\n— home screen —");
await anish.goto(BASE, { waitUntil: "networkidle" });
const homeText = await anish.innerText("body");
check("signed in, shows room list heading", homeText.includes("Rooms"), homeText.slice(0, 200));
check("shows the seeded room", homeText.includes("Apartment 4B"));
check("shows a balance summary", /owed|owe|settled/.test(homeText));
await anish.screenshot({ path: `${OUT}/02-home.png`, fullPage: true });

console.log("\n— expenses tab —");
await anish.getByRole("link", { name: /Apartment 4B/ }).first().click();
await anish.waitForURL(/\/rooms\/[0-9a-f-]+$/, { timeout: 15000 });
await anish.waitForLoadState("networkidle");
check("lands on the expenses tab", anish.url().includes("/rooms/"), anish.url());
const expText = await anish.innerText("body");
check("lists a seeded expense", expText.includes("Costco run"), expText.slice(0, 300));
check("shows who paid", /paid \$/.test(expText));
let live = false;
for (let i = 0; i < 40; i++) {
  if ((await anish.innerText("body")).includes("Live")) { live = true; break; }
  await anish.waitForTimeout(250);
}
check("realtime indicator reaches Live", live);
await anish.screenshot({ path: `${OUT}/03-expenses.png`, fullPage: true });
const roomUrl = anish.url();

console.log("\n— add expense dialog: all four split modes —");
await anish.getByRole("button", { name: "Add expense" }).last().click();
await anish.waitForTimeout(600);
check("dialog opens", await anish.getByText("Add an expense").isVisible());
for (const mode of ["Equally", "Exact amounts", "Percentages", "Just me"]) {
  check(`${mode} mode is offered`, await anish.getByRole("button", { name: new RegExp(mode) }).first().isVisible());
}
await anish.screenshot({ path: `${OUT}/04-add-expense.png`, fullPage: true });

// Save button must be blocked until the form is valid.
const saveBtn = anish.getByRole("button", { name: "Add expense" }).last();
check("save is blocked on an empty form", await saveBtn.isDisabled());
check("tells you what's missing", (await anish.innerText("body")).includes("Add a description"));

await anish.getByLabel("What was it for?").fill("Pizza night");
await anish.getByLabel("Amount").fill("40.00");
await anish.waitForTimeout(400);
check("save unlocks once valid", await saveBtn.isEnabled());
const equalPreview = await anish.innerText("body");
check("equal split previews $13.34/$13.33 for 3 people",
  equalPreview.includes("$13.34") && equalPreview.includes("$13.33"), "no penny-accurate preview");

// Exact mode should refuse a total that doesn't add up.
await anish.getByRole("button", { name: /Exact amounts/ }).first().click();
await anish.waitForTimeout(300);
const shareInputs = anish.locator('input[id^="share-"]');
await shareInputs.nth(0).fill("10.00");
await anish.waitForTimeout(400);
check("exact mode reports the shortfall",
  (await anish.innerText("body")).includes("$30.00 still to assign"),
  (await anish.innerText("body")).match(/still to assign|over the total/)?.[0] ?? "no message");
check("save blocked while short", await saveBtn.isDisabled());
await shareInputs.nth(1).fill("35.00");
await anish.waitForTimeout(400);
check("exact mode reports going over",
  (await anish.innerText("body")).includes("over the total"));
await shareInputs.nth(1).fill("30.00");
await anish.waitForTimeout(400);
check("save unlocks when it balances exactly", await saveBtn.isEnabled());
await anish.screenshot({ path: `${OUT}/05-exact-split.png`, fullPage: true });

console.log("\n— realtime: Nav sees Anish's expense —");
await nav.goto(roomUrl, { waitUntil: "networkidle" });
check("Nav can see the room too", (await nav.innerText("body")).includes("Costco run"));
const navBefore = await nav.innerText("body");
check("Nav does not see the new expense yet", !navBefore.includes("Pizza night"));

await saveBtn.click();
await anish.waitForTimeout(1200);
check("expense saved and dialog closed",
  (await anish.innerText("body")).includes("Pizza night"));

// No reload: the row must arrive over the websocket.
let arrived = false;
for (let i = 0; i < 40; i++) {
  if ((await nav.innerText("body")).includes("Pizza night")) { arrived = true; break; }
  await nav.waitForTimeout(250);
}
check("expense appeared on Nav's screen with no reload", arrived);
await nav.screenshot({ path: `${OUT}/06-realtime-nav.png`, fullPage: true });

console.log("\n— balances tab —");
await anish.goto(`${roomUrl}/balances`, { waitUntil: "networkidle" });
const balText = await anish.innerText("body");
check("balances tab renders", balText.includes("Balances"));
check("shows simplified transfers or all-square", /owes|owe|square/.test(balText));
check("shows the per-person breakdown", /per person/i.test(balText));
check("shows recorded payments", /payments/i.test(balText));
await anish.screenshot({ path: `${OUT}/07-balances.png`, fullPage: true });

console.log("\n— chores tab —");
await anish.goto(`${roomUrl}/chores`, { waitUntil: "networkidle" });
await nav.goto(`${roomUrl}/chores`, { waitUntil: "networkidle" });
const choreText = await anish.innerText("body");
check("chores tab renders", choreText.includes("Chores"));
check("has To do / Mine / Done filters",
  choreText.includes("To do") && choreText.includes("Mine") && choreText.includes("Done"));
check("shows the seeded chore", choreText.includes("Take out trash"));
await anish.screenshot({ path: `${OUT}/08-chores.png`, fullPage: true });

console.log("\n— chores: assign and tick, live —");
await anish.getByPlaceholder("Add a chore…").fill("Clean the bathroom");
await anish.waitForTimeout(300);
check("assignee picker appears on focus",
  await anish.getByRole("button", { name: /^Anyone$/ }).isVisible());
await anish.getByRole("button", { name: /Nav/ }).first().click();
await anish.getByRole("button", { name: "Add", exact: true }).click();
await anish.waitForTimeout(1200);
check("chore added", (await anish.innerText("body")).includes("Clean the bathroom"));

let choreArrived = false;
for (let i = 0; i < 40; i++) {
  if ((await nav.innerText("body")).includes("Clean the bathroom")) { choreArrived = true; break; }
  await nav.waitForTimeout(250);
}
check("chore appeared on Nav's screen with no reload", choreArrived);

// Nav ticks it off; Anish must see it check itself.
await nav.getByRole("checkbox", { name: /Clean the bathroom/ }).click();
await nav.waitForTimeout(800);
let tickArrived = false;
for (let i = 0; i < 40; i++) {
  const t = await anish.innerText("body");
  // Once done it leaves the "To do" filter, so the count is the tell.
  if (!t.includes("Clean the bathroom")) { tickArrived = true; break; }
  await anish.waitForTimeout(250);
}
check("Nav ticking the chore updated Anish's screen", tickArrived);
await anish.screenshot({ path: `${OUT}/09-chores-live.png`, fullPage: true });

await anish.getByRole("button", { name: /Done/ }).first().click();
await anish.waitForTimeout(600);
check("completed chore shows under Done",
  (await anish.innerText("body")).includes("Clean the bathroom"));

console.log("\n— settings / invites —");
await anish.goto(`${roomUrl}/settings`, { waitUntil: "networkidle" });
const setText = await anish.innerText("body");
check("settings renders", setText.includes("Invite link"));
const inviteValue = await anish.locator('input[readonly]').first().inputValue();
check("shows a shareable join link", inviteValue.includes("/join/"), inviteValue);
check("offers both join modes",
  setText.includes("Anyone with the link") && setText.includes("Only invited emails"));
check("lists members", setText.includes("Members"));
check("has a danger zone", setText.includes("Danger zone"));
await anish.screenshot({ path: `${OUT}/10-settings.png`, fullPage: true });

console.log(`\n${"=".repeat(60)}`);
console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log("  - " + f);
const realErrors = consoleErrors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e));
if (realErrors.length) {
  console.log("\nconsole errors:");
  for (const e of realErrors.slice(0, 12)) console.log("  " + e);
} else {
  console.log("\nno console errors");
}
console.log("=".repeat(60));
await browser.close();
process.exit(fails.length === 0 && realErrors.length === 0 ? 0 : 1);
