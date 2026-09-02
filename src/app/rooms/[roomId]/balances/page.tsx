import { BalancesTab } from "@/components/balances/balances-tab";
import { requireRoomContext } from "@/lib/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchBalances, fetchSettlements } from "@/lib/queries";

export default async function BalancesPage({
  params,
}: PageProps<"/rooms/[roomId]/balances">) {
  const { roomId } = await params;
  const { members, me } = await requireRoomContext(roomId);

  const supabase = await createSupabaseServerClient();
  const [balances, settlements] = await Promise.all([
    fetchBalances(supabase, roomId),
    fetchSettlements(supabase, roomId),
  ]);

  return (
    <BalancesTab
      roomId={roomId}
      meId={me.id}
      members={members.map((m) => m.profile)}
      initialBalances={balances}
      initialSettlements={settlements}
    />
  );
}
