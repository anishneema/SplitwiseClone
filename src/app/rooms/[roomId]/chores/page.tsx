import { ChoresTab } from "@/components/chores/chores-tab";
import { requireRoomContext } from "@/lib/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchChores } from "@/lib/queries";

export default async function ChoresPage({ params }: PageProps<"/rooms/[roomId]/chores">) {
  const { roomId } = await params;
  const { members, me } = await requireRoomContext(roomId);

  const supabase = await createSupabaseServerClient();
  const chores = await fetchChores(supabase, roomId);

  return (
    <ChoresTab
      roomId={roomId}
      meId={me.id}
      members={members.map((m) => m.profile)}
      initialChores={chores}
    />
  );
}
