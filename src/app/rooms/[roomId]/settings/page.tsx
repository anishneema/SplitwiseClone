import { RoomSettings } from "@/components/rooms/room-settings";
import { requireRoomContext } from "@/lib/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function SettingsPage({
  params,
}: PageProps<"/rooms/[roomId]/settings">) {
  const { roomId } = await params;
  const { room, members, me, isOwner } = await requireRoomContext(roomId);

  const supabase = await createSupabaseServerClient();
  const { data: invites } = await supabase
    .from("room_invites")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });

  // Prefer the configured public URL so a link copied on localhost is still
  // shareable; fall back to the Vercel-provided host, then localhost.
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");

  return (
    <RoomSettings
      room={room}
      members={members}
      invites={invites ?? []}
      me={me}
      isOwner={isOwner}
      inviteUrl={`${origin}/join/${room.invite_code}`}
    />
  );
}
