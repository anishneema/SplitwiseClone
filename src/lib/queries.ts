import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Chore,
  Database,
  Expense,
  ExpenseSplit,
  RoomBalanceRow,
  Settlement,
} from "@/lib/types/database";

/**
 * Query functions shared by the server (initial render) and the browser
 * (Realtime refetch), so a tab's data shape is defined exactly once.
 */
export type Client = SupabaseClient<Database>;

export type ExpenseWithSplits = Expense & { splits: ExpenseSplit[] };

export async function fetchExpenses(
  supabase: Client,
  roomId: string,
): Promise<ExpenseWithSplits[]> {
  const [{ data: expenses, error }, { data: splits }] = await Promise.all([
    supabase
      .from("expenses")
      .select("*")
      .eq("room_id", roomId)
      .order("spent_at", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("expense_splits").select("*").eq("room_id", roomId),
  ]);

  if (error) throw error;

  const splitsByExpense = new Map<string, ExpenseSplit[]>();
  for (const split of splits ?? []) {
    const list = splitsByExpense.get(split.expense_id) ?? [];
    list.push(split);
    splitsByExpense.set(split.expense_id, list);
  }

  return (expenses ?? []).map((expense) => ({
    ...expense,
    splits: splitsByExpense.get(expense.id) ?? [],
  }));
}

export async function fetchSettlements(
  supabase: Client,
  roomId: string,
): Promise<Settlement[]> {
  const { data, error } = await supabase
    .from("settlements")
    .select("*")
    .eq("room_id", roomId)
    .order("settled_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function fetchBalances(
  supabase: Client,
  roomId: string,
): Promise<RoomBalanceRow[]> {
  const { data, error } = await supabase.rpc("room_balances", { p_room_id: roomId });
  if (error) throw error;
  return data ?? [];
}

export async function fetchChores(supabase: Client, roomId: string): Promise<Chore[]> {
  const { data, error } = await supabase
    .from("chores")
    .select("*")
    .eq("room_id", roomId)
    .order("done", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/** What this expense means for one person: what they owe, what they lent. */
export function shareFor(expense: ExpenseWithSplits, userId: string) {
  const owed = expense.splits.find((s) => s.user_id === userId)?.owed_cents ?? 0;
  const paid = expense.paid_by === userId ? expense.amount_cents : 0;
  return { owed, paid, net: paid - owed, involved: paid > 0 || owed > 0 };
}
