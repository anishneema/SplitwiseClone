import { ShoppingTab } from "@/components/shopping/shopping-tab";
import { requireRoomContext } from "@/lib/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchShoppingItems } from "@/lib/queries";

export default async function ShoppingPage({
  params,
}: PageProps<"/rooms/[roomId]/shopping">) {
  const { roomId } = await params;

  // Repeated in every page of this segment on purpose: the layout's copy of
  // this check does not gate rendering. React cache() dedupes the queries.
  const { members, me } = await requireRoomContext(roomId);

  const supabase = await createSupabaseServerClient();
  const items = await fetchShoppingItems(supabase, roomId);

  return (
    <ShoppingTab
      roomId={roomId}
      meId={me.id}
      members={members.map((m) => m.profile)}
      initialItems={items}
    />
  );
}
