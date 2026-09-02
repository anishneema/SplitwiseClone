import { ExpensesTab } from "@/components/expenses/expenses-tab";
import { requireRoomContext } from "@/lib/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchBalances, fetchExpenses } from "@/lib/queries";

export default async function ExpensesPage({ params }: PageProps<"/rooms/[roomId]">) {
  const { roomId } = await params;

  // Repeated in every page of this segment on purpose: the layout's copy of
  // this check does not gate rendering. React cache() dedupes the queries.
  const { members, me } = await requireRoomContext(roomId);

  const supabase = await createSupabaseServerClient();
  const [expenses, balances] = await Promise.all([
    fetchExpenses(supabase, roomId),
    fetchBalances(supabase, roomId),
  ]);

  return (
    <ExpensesTab
      roomId={roomId}
      meId={me.id}
      members={members.map((m) => m.profile)}
      initialExpenses={expenses}
      initialBalances={balances}
    />
  );
}
