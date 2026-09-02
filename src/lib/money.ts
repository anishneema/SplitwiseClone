/**
 * All money in this app is integer cents. Dollars only ever exist as strings
 * for display or as raw form input; a float dollar amount is never stored,
 * summed, or split, because `0.1 + 0.2 !== 0.3` quietly corrupts balances.
 */

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** 1234 -> "$12.34". Negative values format as "-$12.34". */
export function formatCents(cents: number): string {
  return USD.format(cents / 100);
}

/** 1234 -> "12.34". For prefilling text inputs. */
export function centsToInput(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2);
}

/** 1234 -> "$12.34", but drops ".00" for whole dollars: 1200 -> "$12". */
export function formatCentsShort(cents: number): string {
  return cents % 100 === 0
    ? `${cents < 0 ? "-" : ""}$${Math.abs(cents) / 100}`
    : formatCents(cents);
}

/**
 * Parse user-typed dollars into integer cents. Accepts "12", "12.3", "12.34",
 * "$12.34", "1,234.56". Returns null for anything it can't read exactly, so
 * callers surface a validation error rather than storing a guess.
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  if (!/\d/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const [whole, frac = ""] = cleaned.replace("-", "").split(".");
  const cents =
    Number(whole || "0") * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/**
 * Split a total evenly, distributing the indivisible remainder one cent at a
 * time to the leading participants so the parts always sum to exactly `total`.
 *
 * $10.00 across 3 people -> 334 / 333 / 333, not 3 x 333.33.
 */
export function splitEqual(
  totalCents: number,
  userIds: string[],
): Record<string, number> {
  if (userIds.length === 0) return {};
  const base = Math.floor(totalCents / userIds.length);
  let remainder = totalCents - base * userIds.length;

  const out: Record<string, number> = {};
  for (const id of userIds) {
    out[id] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  }
  return out;
}

/**
 * Split by percentage. Percentages must total 100; the cent remainder goes to
 * whoever has the largest fractional part, which keeps each share closest to
 * its true percentage.
 */
export function splitByPercent(
  totalCents: number,
  percentByUser: Record<string, number>,
): Record<string, number> {
  const entries = Object.entries(percentByUser);
  if (entries.length === 0) return {};

  const exact = entries.map(([id, pct]) => {
    const value = (totalCents * pct) / 100;
    return { id, floor: Math.floor(value), frac: value - Math.floor(value) };
  });

  let remainder = totalCents - exact.reduce((sum, e) => sum + e.floor, 0);
  const byFracDesc = [...exact].sort((a, b) => b.frac - a.frac);
  const bonus = new Set<string>();
  for (const e of byFracDesc) {
    if (remainder <= 0) break;
    bonus.add(e.id);
    remainder -= 1;
  }

  return Object.fromEntries(
    exact.map((e) => [e.id, e.floor + (bonus.has(e.id) ? 1 : 0)]),
  );
}

/** Sum of a split map. Used to drive the "$X left to assign" indicator. */
export function sumSplits(splits: Record<string, number>): number {
  return Object.values(splits).reduce((sum, c) => sum + c, 0);
}
