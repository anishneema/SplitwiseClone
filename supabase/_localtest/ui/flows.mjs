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

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
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
check("the room has a Shopping section",
  await anish.getByRole("link", { name: "Shopping" }).isVisible());
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

console.log("\n— shopping list tab —");
await anish.goto(`${roomUrl}/shopping`, { waitUntil: "networkidle" });
await nav.goto(`${roomUrl}/shopping`, { waitUntil: "networkidle" });
const shopText = await anish.innerText("body");
check("shopping tab renders", shopText.includes("Shopping list"));
check("has To buy / On me / Bought filters",
  shopText.includes("To buy") && shopText.includes("On me") && shopText.includes("Bought"));
check("shows a seeded item and its quantity",
  shopText.includes("Oat milk") && shopText.includes("2 cartons"), shopText.slice(0, 300));
check("an already-bought item is not on the To buy list",
  !shopText.includes("Dish soap"));
await anish.getByRole("button", { name: /^Bought/ }).click();
await anish.waitForTimeout(600);
check("the bought item is under Bought",
  (await anish.innerText("body")).includes("Dish soap"));
await anish.getByRole("button", { name: /^To buy/ }).click();
await anish.waitForTimeout(400);
await anish.screenshot({ path: `${OUT}/11-shopping.png`, fullPage: true });

console.log("\n— shopping: ask, claim and tick, live —");
await anish.getByPlaceholder("Add something you need…").fill("Coffee beans");
await anish.waitForTimeout(300);
await anish.getByRole("button", { name: "Add", exact: true }).click();
await anish.waitForTimeout(1200);
check("item added", (await anish.innerText("body")).includes("Coffee beans"));

let itemArrived = false;
for (let i = 0; i < 40; i++) {
  if ((await nav.innerText("body")).includes("Coffee beans")) { itemArrived = true; break; }
  await nav.waitForTimeout(250);
}
check("item appeared on Nav's screen with no reload", itemArrived);

// The item is Anish's request, so only Anish gets an editor on it. For Nav the
// name is plain text -- no control that the database would refuse.
check("Anish can open his own item for editing",
  (await anish.getByRole("button", { name: /Coffee beans/ }).count()) === 1);
check("an item defaults to being for whoever asked",
  /Coffee beans[\s\S]{0,80}for you/.test(await anish.innerText("body")),
  (await anish.innerText("body")).match(/Coffee beans[^\n]*\n[^\n]*/)?.[0] ?? "no row");

// "Who it's for" takes several people, which is what decides the split later.
await anish.getByPlaceholder("Add something you need…").fill("Sponges");
await anish.waitForTimeout(300);
await anish.getByRole("group", { name: "Who it's for" })
  .getByRole("button", { name: "Everyone" }).click();
await anish.getByRole("button", { name: "Add", exact: true }).click();
await anish.waitForTimeout(1200);
check("an item can be for the whole house",
  /Sponges[\s\S]{0,80}for everyone/.test(await anish.innerText("body")),
  (await anish.innerText("body")).match(/Sponges[^\n]*\n[^\n]*/)?.[0] ?? "no row");
check("Nav gets no editor on someone else's item",
  (await nav.getByRole("button", { name: /Coffee beans/ }).count()) === 0);

const beansRow = nav.locator("li", { hasText: "Coffee beans" });
await beansRow.getByRole("button", { name: "I'll get it" }).click();
await nav.waitForTimeout(1000);
let claimArrived = false;
for (let i = 0; i < 40; i++) {
  if (/Nav is getting it/.test(await anish.innerText("body"))) { claimArrived = true; break; }
  await anish.waitForTimeout(250);
}
check("Nav claiming the item showed up on Anish's screen", claimArrived);

await nav.getByRole("button", { name: /^On me/ }).click();
await nav.waitForTimeout(600);
check("the claimed item is listed under On me for Nav",
  (await nav.innerText("body")).includes("Coffee beans"));

await nav.getByRole("checkbox", { name: /Coffee beans/ }).click();
await nav.waitForTimeout(800);
let boughtArrived = false;
for (let i = 0; i < 40; i++) {
  // Once bought it leaves the To buy list Anish is looking at.
  if (!(await anish.innerText("body")).includes("Coffee beans")) { boughtArrived = true; break; }
  await anish.waitForTimeout(250);
}
check("Nav buying the item updated Anish's screen", boughtArrived);
await anish.screenshot({ path: `${OUT}/12-shopping-live.png`, fullPage: true });

console.log("\n— shopping: pricing a trip turns it into a charge —");
// Nav has just bought Anish's coffee beans, plus Sam's dish soap from the seed.
await nav.goto(`${roomUrl}/shopping`, { waitUntil: "networkidle" });
await nav.waitForTimeout(800);
const navShop = await nav.innerText("body");
check("Nav is prompted to price what he bought", /You bought \d+ things?/.test(navShop),
  navShop.slice(0, 300));

await nav.getByRole("button", { name: "Add prices" }).click();
await nav.waitForTimeout(800);
check("the price sheet opens", await nav.getByText("What did it come to?").isVisible());
const sheet = await nav.innerText("body");
check("it lists what he bought", sheet.includes("Coffee beans") && sheet.includes("Dish soap"),
  sheet.slice(0, 400));
check("and who each thing was for, decided when it was asked for",
  /Coffee beans[\s\S]{0,60}for Anish/.test(sheet), sheet.slice(0, 400));

const addCharge = nav.getByRole("button", { name: /Add .* charge/ });
check("nothing to charge until a price is typed", await addCharge.isDisabled());
check("it says so", sheet.includes("Put a price against at least one thing"));

await nav.getByLabel("Price of Coffee beans").fill("6.00");
await nav.waitForTimeout(500);
const priced = await nav.innerText("body");
check("the preview charges it to the person it was for",
  /Anish[\s\S]{0,40}owes you[\s\S]{0,40}\$6\.00/.test(priced),
  priced.match(/comes back to you[\s\S]{0,160}/)?.[0] ?? "no preview");
check("the button shows what will be charged",
  /Add \$6\.00 charge/.test(await addCharge.innerText()), await addCharge.innerText());
await nav.screenshot({ path: `${OUT}/13-charge-prices.png`, fullPage: true });

await addCharge.click();
await nav.waitForTimeout(1500);
check("the sheet closes", (await nav.getByText("What did it come to?").count()) === 0);

// Both are bought, so they live under Bought rather than To buy.
await nav.getByRole("button", { name: /^Bought/ }).click();
await nav.waitForTimeout(600);
const afterCharge = await nav.innerText("body");
check("the charged item reads as charged, with its price",
  /Coffee beans[\s\S]{0,80}charged/.test(afterCharge) && afterCharge.includes("$6.00"),
  afterCharge.match(/Coffee beans[^\n]*\n[^\n]*/)?.[0] ?? "no row");
check("the unpriced item stays on the list for next time",
  afterCharge.includes("Dish soap"));
check("and is still waiting to be priced",
  /You bought 1 thing/.test(afterCharge), afterCharge.slice(0, 200));

// The charge is a normal expense, so it must reach Anish over the websocket.
await anish.goto(roomUrl, { waitUntil: "networkidle" });
let chargeArrived = false;
for (let i = 0; i < 40; i++) {
  const t = await anish.innerText("body");
  if (t.includes("Shopping list") && t.includes("$6.00")) { chargeArrived = true; break; }
  await anish.waitForTimeout(250);
}
check("the charge shows up on the expenses tab", chargeArrived,
  (await anish.innerText("body")).slice(0, 400));

await anish.goto(`${roomUrl}/balances`, { waitUntil: "networkidle" });
await anish.waitForTimeout(600);
check("and moves the balances",
  /owes|owe/.test(await anish.innerText("body")));
await anish.screenshot({ path: `${OUT}/14-charge-on-expenses.png`, fullPage: true });

// The bug this guards: a trip that includes your own share must never read as
// though you are being charged for it, or as money lent to yourself.
console.log("\n— shopping: your own share is not a debt —");
await anish.goto(`${roomUrl}/shopping`, { waitUntil: "networkidle" });
await anish.waitForTimeout(800);
// Seeded: Anish bought the bin bags, which are for the whole house.
await anish.getByRole("button", { name: "Add prices" }).click();
await anish.waitForTimeout(700);
await anish.getByLabel("Price of Bin bags").fill("9.20");
await anish.waitForTimeout(500);
const shared = await anish.innerText("body");
check("the preview leads with what actually comes back to you",
  /What comes back to you[\s\S]{0,40}\$6\.13 of \$9\.20/.test(shared),
  shared.match(/What comes back to you[\s\S]{0,120}/)?.[0] ?? "no preview");
check("only the others are listed as owing",
  /Nav Patel owes you/.test(shared) && /Sam Cole owes you/.test(shared)
    && !/You owes you/.test(shared),
  shared.match(/comes back to you[\s\S]{0,200}/)?.[0] ?? "");
check("and your own share is called out as not charged to you",
  /\$3\.07 is your own share[\s\S]{0,60}already paid it/.test(shared),
  shared.match(/your own share[^\n]*\n?[^\n]*/)?.[0] ?? "no note");
await anish.screenshot({ path: `${OUT}/15-own-share.png`, fullPage: true });

await anish.getByRole("button", { name: /Add \$9\.20 charge/ }).click();
await anish.waitForTimeout(1500);
await anish.goto(roomUrl, { waitUntil: "networkidle" });
await anish.waitForTimeout(800);
const ledger = await anish.innerText("body");
check("the expense records the full spend but only lends the others' share",
  /You paid \$9\.20[\s\S]{0,60}you lent[\s\S]{0,20}\$6\.13/.test(ledger),
  ledger.match(/You paid \$9\.20[\s\S]{0,80}/)?.[0] ?? "no row");

// And a trip that is entirely your own is just your own spending.
await anish.goto(`${roomUrl}/shopping`, { waitUntil: "networkidle" });
await anish.waitForTimeout(600);
await anish.getByRole("checkbox", { name: /Oat milk/ }).click();
await anish.waitForTimeout(1200);
await anish.getByRole("button", { name: "Add prices" }).click();
await anish.waitForTimeout(700);
await anish.getByLabel("Price of Oat milk").fill("4.50");
await anish.waitForTimeout(500);
const solo = await anish.innerText("body");
check("a trip only for yourself says nothing comes back",
  /Nothing — all of this was for you/.test(solo),
  solo.match(/comes back to you[\s\S]{0,160}/)?.[0] ?? "no preview");
await anish.getByRole("button", { name: /Add \$4\.50 charge/ }).click();
await anish.waitForTimeout(1500);
await anish.goto(roomUrl, { waitUntil: "networkidle" });
await anish.waitForTimeout(800);
const soloLedger = await anish.innerText("body");
// The row is titled "Shopping list"; the item names go into the expense note.
check("and is logged as unsplit rather than lent to yourself",
  /You paid \$4\.50[\s\S]{0,60}not split/.test(soloLedger)
    && !/You paid \$4\.50[\s\S]{0,60}you lent/.test(soloLedger),
  soloLedger.match(/You paid \$4\.50[\s\S]{0,80}/)?.[0] ?? "no row");

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
