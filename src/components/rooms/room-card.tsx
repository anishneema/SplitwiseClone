import Link from "next/link";
import { MemberAvatarStack } from "@/components/member-avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MoneyAmount } from "@/components/money-amount";

type RoomSummary = {
  id: string;
  name: string;
  kind: "room" | "trip";
  member_count: number;
  my_net_cents: number;
  open_chore_count: number;
};

export function RoomCard({
  room,
  members,
}: {
  room: RoomSummary;
  members: Array<{ id: string; display_name: string; avatar_url: string | null }>;
}) {
  const settled = room.my_net_cents === 0;

  return (
    <Card className="p-0 transition-colors hover:bg-accent/40">
      <Link
        href={`/rooms/${room.id}`}
        className="flex items-center gap-4 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-medium">{room.name}</h2>
            {room.kind === "trip" ? (
              <Badge variant="secondary" className="shrink-0">
                Trip
              </Badge>
            ) : null}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <MemberAvatarStack members={members} />
            <span className="text-xs text-muted-foreground">
              {room.member_count} {room.member_count === 1 ? "member" : "members"}
              {room.open_chore_count > 0
                ? ` · ${room.open_chore_count} open ${
                    room.open_chore_count === 1 ? "chore" : "chores"
                  }`
                : null}
            </span>
          </div>
        </div>

        <div className="shrink-0 text-right">
          {settled ? (
            <span className="text-sm text-muted-foreground">settled up</span>
          ) : (
            <>
              <span className="block text-xs text-muted-foreground">
                {room.my_net_cents > 0 ? "you're owed" : "you owe"}
              </span>
              <MoneyAmount cents={room.my_net_cents} className="text-lg" />
            </>
          )}
        </div>
      </Link>
    </Card>
  );
}
