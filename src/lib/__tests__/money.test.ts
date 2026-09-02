import { describe, expect, it } from "vitest";
import {
  formatCents,
  parseDollarsToCents,
  splitByPercent,
  splitEqual,
  sumSplits,
} from "../money";

describe("formatCents", () => {
  it("formats whole and fractional amounts", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(1234)).toBe("$12.34");
    expect(formatCents(-1234)).toBe("-$12.34");
    expect(formatCents(100000)).toBe("$1,000.00");
  });
});

describe("parseDollarsToCents", () => {
  it("accepts the shapes people actually type", () => {
    expect(parseDollarsToCents("12")).toBe(1200);
    expect(parseDollarsToCents("12.3")).toBe(1230);
    expect(parseDollarsToCents("12.34")).toBe(1234);
    expect(parseDollarsToCents("$12.34")).toBe(1234);
    expect(parseDollarsToCents("1,234.56")).toBe(123456);
    expect(parseDollarsToCents("  0.05 ")).toBe(5);
    expect(parseDollarsToCents(".5")).toBe(50);
  });

  it("rejects junk rather than guessing", () => {
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("12.345")).toBeNull();
    expect(parseDollarsToCents("1.2.3")).toBeNull();
    expect(parseDollarsToCents("$")).toBeNull();
  });

  it("does not accumulate float error", () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in cents it is exact.
    expect(parseDollarsToCents("0.10")! + parseDollarsToCents("0.20")!).toBe(30);
  });
});

describe("splitEqual", () => {
  it("splits evenly when it divides cleanly", () => {
    expect(splitEqual(3000, ["a", "b", "c"])).toEqual({ a: 1000, b: 1000, c: 1000 });
  });

  it("distributes the remainder so the parts sum exactly", () => {
    expect(splitEqual(1000, ["a", "b", "c"])).toEqual({ a: 334, b: 333, c: 333 });
    expect(splitEqual(1, ["a", "b", "c"])).toEqual({ a: 1, b: 0, c: 0 });
  });

  it("always sums to the total for awkward amounts", () => {
    const cases: Array<[number, number]> = [
      [1000, 3], [1, 3], [10000, 7], [999, 8], [5, 4], [123457, 11], [0, 3],
    ];
    for (const [total, n] of cases) {
      const ids = Array.from({ length: n }, (_, i) => `u${i}`);
      const split = splitEqual(total, ids);
      expect(sumSplits(split), `${total} across ${n}`).toBe(total);
      expect(Object.keys(split)).toHaveLength(n);
    }
  });

  it("keeps every share within one cent of the others", () => {
    const ids = Array.from({ length: 7 }, (_, i) => `u${i}`);
    const values = Object.values(splitEqual(10000, ids));
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  });

  it("handles a single participant and an empty group", () => {
    expect(splitEqual(1234, ["a"])).toEqual({ a: 1234 });
    expect(splitEqual(1234, [])).toEqual({});
  });
});

describe("splitByPercent", () => {
  it("splits clean percentages exactly", () => {
    expect(splitByPercent(10000, { a: 50, b: 25, c: 25 })).toEqual({
      a: 5000, b: 2500, c: 2500,
    });
  });

  it("sums to the total when percentages do not divide cleanly", () => {
    const split = splitByPercent(1000, { a: 33.33, b: 33.33, c: 33.34 });
    expect(sumSplits(split)).toBe(1000);
  });

  it("gives the leftover cent to the largest fractional share", () => {
    // 10.00 at 1/3 each: exact shares are 333.33, so one person gets 334.
    const split = splitByPercent(1000, { a: 30, b: 30, c: 40 });
    expect(sumSplits(split)).toBe(1000);
    expect(split).toEqual({ a: 300, b: 300, c: 400 });
  });
});
