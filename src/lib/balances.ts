/**
 * Turning per-person net balances into a short list of "pay this person that
 * much" transfers.
 *
 * Convention throughout: net > 0 means the room owes this person (they are up
 * money), net < 0 means they owe the room. Over a whole room the nets always
 * sum to zero.
 */

export type NetBalance = { userId: string; netCents: number };
export type Transfer = { from: string; to: string; amountCents: number };

/**
 * Greedy debt simplification: repeatedly settle the largest debtor against the
 * largest creditor. With n people this produces at most n-1 transfers, which is
 * what turns a balance matrix into "you owe Nav $18.50".
 *
 * This is the same idea as Splitwise's "simplify debts" — it does not preserve
 * who originally paid whom, only that everyone ends at zero.
 */
export function simplifyDebts(balances: NetBalance[]): Transfer[] {
  // Copy before mutating; sort for deterministic output given equal amounts.
  const creditors = balances
    .filter((b) => b.netCents > 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.netCents - a.netCents || a.userId.localeCompare(b.userId));
  const debtors = balances
    .filter((b) => b.netCents < 0)
    .map((b) => ({ ...b, netCents: -b.netCents }))
    .sort((a, b) => b.netCents - a.netCents || a.userId.localeCompare(b.userId));

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].netCents, creditors[j].netCents);
    if (amount > 0) {
      transfers.push({
        from: debtors[i].userId,
        to: creditors[j].userId,
        amountCents: amount,
      });
    }
    debtors[i].netCents -= amount;
    creditors[j].netCents -= amount;
    if (debtors[i].netCents === 0) i += 1;
    if (creditors[j].netCents === 0) j += 1;
  }

  return transfers;
}

/** The transfers that involve a specific person, from their point of view. */
export function transfersFor(transfers: Transfer[], userId: string) {
  return {
    youOwe: transfers.filter((t) => t.from === userId),
    owedToYou: transfers.filter((t) => t.to === userId),
  };
}
