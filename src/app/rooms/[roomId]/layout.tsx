import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { RoomTabs } from "@/components/rooms/room-tabs";
import { InviteButton } from "@/components/rooms/invite-button";
import { getRoomContext, requireUser } from "@/lib/dal";

/**
 * Room chrome only.
 *
 * Uses the nullable `getRoomContext` on purpose. `notFound()` thrown from a
 * layout is resolved against the parent segment's boundary — the root 404 — so
 * throwing here would replace this segment's own not-found page with a bare
 * "This page could not be found". The page below does the gating, and its
 * `notFound()` renders `rooms/[roomId]/not-found.tsx` as intended.
 */
export default async function RoomLayout({ params, children }: LayoutProps<"/rooms/[roomId]">) {
  const { roomId } = await params;
  const me = await requireUser(`/rooms/${roomId}`);
  const context = await getRoomContext(roomId);

  // Not a member (or no such room): render just the header, and let the page
  // explain what happened.
  if (!context) {
    return (
      <>
        <AppHeader user={me} />
        {children}
      </>
    );
  }

  const { room, members } = context;

  return (
    <>
      <AppHeader user={me}>
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <Link
            href={`/rooms/${room.id}`}
            className="truncate font-medium hover:underline"
          >
            {room.name}
          </Link>
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
          <InviteButton inviteCode={room.invite_code} roomName={room.name} />
        </div>
      </AppHeader>

      <RoomTabs roomId={room.id} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-5">
        {children}
      </main>
    </>
  );
}
