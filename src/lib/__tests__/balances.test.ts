import { describe, expect, it } from "vitest";
import { simplifyDebts, type NetBalance } from "../balances";

const sum = (ns: NetBalance[]) => ns.reduce((s, b) => s + b.netCents, 0);

describe("simplifyDebts", () => {
  it("settles a simple two-person debt", () => {
    expect(
      simplifyDebts([
        { userId: "a", netCents: -1000 },
        { userId: "b", netCents: 1000 },
      ]),
    ).toEqual([{ from: "a", to: "b", amountCents: 1000 }]);
  });

  it("returns nothing when everyone is square", () => {
    expect(simplifyDebts([
      { userId: "a", netCents: 0 },
      { userId: "b", netCents: 0 },
    ])).toEqual([]);
    expect(simplifyDebts([])).toEqual([]);
  });

  it("uses at most n-1 transfers", () => {
    const balances: NetBalance[] = [
      { userId: "a", netCents: -1500 },
      { userId: "b", netCents: -500 },
      { userId: "c", netCents: 2000 },
    ];
    expect(simplifyDebts(balances).length).toBeLessThanOrEqual(balances.length - 1);
  });

  it("leaves everyone at zero and never over-collects", () => {
    const cases: NetBalance[][] = [
      [
        { userId: "a", netCents: -1500 },
        { userId: "b", netCents: -500 },
        { userId: "c", netCents: 2000 },
      ],
      [
        { userId: "a", netCents: 334 },
        { userId: "b", netCents: -167 },
        { userId: "c", netCents: -167 },
      ],
      [
        { userId: "a", netCents: -1 },
        { userId: "b", netCents: -1 },
        { userId: "c", netCents: 2 },
      ],
      [
        { userId: "a", netCents: 5000 },
        { userId: "b", netCents: 2500 },
        { userId: "c", netCents: -7000 },
        { userId: "d", netCents: -500 },
      ],
    ];

    for (const balances of cases) {
      expect(sum(balances), "test fixture must net to zero").toBe(0);
      const transfers = simplifyDebts(balances);

      const applied = new Map(balances.map((b) => [b.userId, b.netCents]));
      for (const t of transfers) {
        expect(t.amountCents).toBeGreaterThan(0);
        applied.set(t.from, applied.get(t.from)! + t.amountCents);
        applied.set(t.to, applied.get(t.to)! - t.amountCents);
      }
      for (const [userId, remaining] of applied) {
        expect(remaining, `${userId} should end square`).toBe(0);
      }
    }
  });

  it("never asks a debtor to pay more than they owe", () => {
    const balances: NetBalance[] = [
      { userId: "a", netCents: -300 },
      { userId: "b", netCents: -700 },
      { userId: "c", netCents: 1000 },
    ];
    const transfers = simplifyDebts(balances);
    const paid = new Map<string, number>();
    for (const t of transfers) {
      paid.set(t.from, (paid.get(t.from) ?? 0) + t.amountCents);
    }
    expect(paid.get("a")).toBe(300);
    expect(paid.get("b")).toBe(700);
  });
});
