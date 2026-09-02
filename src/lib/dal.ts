import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile, Room, RoomMember } from "@/lib/types/database";

/**
 * Data Access Layer. Authorization lives here rather than in layouts: a layout
 * does not re-render on client-side navigation and does not gate whether its
 * children render, so a check there is not a real check.
 * (node_modules/next/dist/docs/01-app/02-guides/authentication.md)
 *
 * Row-level security in Postgres is the backstop. These helpers exist so the
 * UI can fail fast and redirect nicely rather than render an empty page.
 *
 * `cache()` dedupes each of these within a single render pass.
 */

export const getCurrentUser = cache(async (): Promise<Profile | null> => {
  const supabase = await createSupabaseServerClient();

  // getUser() validates the JWT with Supabase. getSession() only decodes the
  // cookie, which a client could have forged.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  // The auth.users trigger normally creates this row. Fall back to the JWT so a
  // brand-new sign-in never renders a broken header.
  return (
    profile ?? {
      id: user.id,
      email: user.email ?? "",
      display_name:
        (user.user_metadata?.full_name as string | undefined) ??
        user.email?.split("@")[0] ??
        "You",
      avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
      created_at: new Date().toISOString(),
    }
  );
});

export async function requireUser(nextPath?: string): Promise<Profile> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(nextPath ? `/?next=${encodeURIComponent(nextPath)}` : "/");
  }
  return user;
}

export type RoomContext = {
  room: Room;
  members: Array<RoomMember & { profile: Profile }>;
  me: Profile;
  isOwner: boolean;
};

/**
 * Loads a room along with its roster, or returns null when the viewer can't see
 * it. RLS means a non-member's select returns nothing, so "not found" and "not
 * allowed" are deliberately the same answer — we don't confirm that a room
 * exists to someone outside it.
 *
 * Layouts must use this rather than `requireRoomContext`: `notFound()` thrown
 * from a layout resolves against the *parent* segment's boundary, i.e. the root
 * 404, so the segment's own not-found page never gets a chance to render.
 */
export const getRoomContext = cache(
  async (roomId: string): Promise<RoomContext | null> => {
    const me = await requireUser(`/rooms/${roomId}`);
    const supabase = await createSupabaseServerClient();

    const [{ data: room }, { data: memberRows }] = await Promise.all([
      supabase.from("rooms").select("*").eq("id", roomId).maybeSingle(),
      supabase.from("room_members").select("*").eq("room_id", roomId),
    ]);

    // RLS returns nothing here for a non-member, which is what makes this both
    // an authorization check and an existence check.
    if (!room) return null;

    const memberIds = (memberRows ?? []).map((m) => m.user_id);
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("*")
      .in("id", memberIds.length > 0 ? memberIds : ["00000000-0000-0000-0000-000000000000"]);

    const profilesById = new Map((profileRows ?? []).map((p) => [p.id, p]));

    const members = (memberRows ?? [])
      .map((m) => ({ ...m, profile: profilesById.get(m.user_id) }))
      .filter((m): m is RoomMember & { profile: Profile } => m.profile !== undefined)
      .sort((a, b) => a.profile.display_name.localeCompare(b.profile.display_name));

    return {
      room,
      members,
      me,
      isOwner: members.some((m) => m.user_id === me.id && m.role === "owner"),
    };
  },
);

/**
 * Same, but 404s when the room isn't visible. Use this in pages — it is what
 * actually gates rendering, and it renders `rooms/[roomId]/not-found.tsx`.
 */
export async function requireRoomContext(roomId: string): Promise<RoomContext> {
  const context = await getRoomContext(roomId);
  if (!context) notFound();
  return context;
}
