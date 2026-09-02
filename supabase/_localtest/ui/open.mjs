/**
 * Opens the seeded local app in real browser windows, already signed in.
 *
 * Google sign-in doesn't work against the local stack -- there's no OAuth client
 * pointed at it -- so there is no way to log in by hand. This loads the session
 * cookies that `npm run db:sessions` minted into a headed browser instead, one
 * window per roommate, so you can watch a write on one screen land on another.
 *
 *   npm run db:start && npm run db:fresh
 *   npm run dev
 *   npm run ui:open              # Anish and Nav, side by side
 *   npm run ui:open anish        # just one
 *   npm run ui:open anish nav sam
 *
 * Needs Playwright's chromium: npm i --no-save playwright && npx playwright install chromium
 * Close the windows, or press Ctrl-C, to finish.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const COOKIE_DIR = process.env.COOKIE_DIR ?? "/tmp";
const SEED_FILE = process.env.SEED_FILE ?? "/tmp/seed.json";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const who = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["anish", "nav"];

function read(path, hint) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.error(`Could not read ${path}.\n${hint}`);
    process.exit(1);
  }
}

const seed = read(SEED_FILE, "Run `npm run db:fresh` first.");
const roomUrl = `${BASE}/rooms/${seed.roomId}`;

// Side-by-side phone-shaped windows: this app is mostly used one-handed, and
// two of them fit on a laptop screen.
const WIDTH = 520;
const HEIGHT = 1000;

const browsers = [];
for (const [i, name] of who.entries()) {
  const cookies = read(
    `${COOKIE_DIR}/cookies-${name}.json`,
    `Run \`npm run db:sessions\`, or check the name -- expected one of anish, nav, sam.`,
  );

  // One browser per person rather than one browser with several contexts:
  // --window-position is a browser-level flag, so this is what actually places
  // the windows next to each other instead of stacking them.
  const browser = await chromium.launch({
    headless: false,
    args: [
      `--window-position=${i * (WIDTH + 20)},0`,
      `--window-size=${WIDTH},${HEIGHT}`,
    ],
  });
  browsers.push(browser);

  const ctx = await browser.newContext({ viewport: null });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  await page.goto(roomUrl, { waitUntil: "domcontentloaded" });
  console.log(`  ${name.padEnd(6)} -> ${roomUrl}`);
}

console.log(`
Signed in as: ${who.join(", ")}
Room:         ${roomUrl}
Studio:       http://127.0.0.1:54323   (poke at the data directly)

Try: add a shopping item in one window and claim it in the other; open the
"Internet bill" charge as Anish (Nav entered it) and see it open read-only.

Close the windows or press Ctrl-C to finish.`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await Promise.allSettled(browsers.map((b) => b.close()));
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// Exit once every window has been closed by hand.
for (const b of browsers) b.on("disconnected", () => {
  if (browsers.every((x) => !x.isConnected())) void shutdown();
});
