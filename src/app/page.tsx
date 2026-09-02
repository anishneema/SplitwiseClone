import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { SetupNotice } from "@/components/setup-notice";
import { SignInButton } from "@/components/sign-in-button";
import { CreateRoomDialog } from "@/components/rooms/create-room-dialog";
import { RoomCard } from "@/components/rooms/room-card";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { formatCents } from "@/lib/money";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { next, error } = await searchParams;
  const user = await getCurrentUser();

  if (!user) {
    return (
      <SignedOutLanding
        next={typeof next === "string" ? next : undefined}
        error={typeof error === "string" ? error : undefined}
      />
    );
  }

  const supabase = await createSupabaseServerClient();

  // RLS scopes both of these to rooms the viewer belongs to, so two queries
  // cover every card including its avatar stack.
  const [{ data: rooms }, { data: memberRows }, { data: profileRows }] =
    await Promise.all([
      supabase.rpc("my_rooms"),
      supabase.from("room_members").select("room_id, user_id"),
      supabase.from("profiles").select("id, display_name, avatar_url"),
    ]);

  const profilesById = new Map((profileRows ?? []).map((p) => [p.id, p]));
  const membersByRoom = new Map<
    string,
    Array<{ id: string; display_name: string; avatar_url: string | null }>
  >();
  for (const row of memberRows ?? []) {
    const profile = profilesById.get(row.user_id);
    if (!profile) continue;
    const list = membersByRoom.get(row.room_id) ?? [];
    list.push(profile);
    membersByRoom.set(row.room_id, list);
  }

  const list = rooms ?? [];
  const owed = list.reduce((sum, r) => sum + Math.max(0, r.my_net_cents), 0);
  const owe = list.reduce((sum, r) => sum + Math.max(0, -r.my_net_cents), 0);

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Rooms &amp; trips
            </h1>
            {list.length > 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {owed === 0 && owe === 0
                  ? "You're all settled up everywhere."
                  : [
                      owed > 0 ? `you're owed ${formatCents(owed)}` : null,
                      owe > 0 ? `you owe ${formatCents(owe)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
            ) : null}
          </div>
          <CreateRoomDialog />
        </div>

        {list.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="font-medium">No rooms yet</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                Create one for your apartment, then share the invite link with
                your roommates. Trips work the same way.
              </p>
              <div className="mt-5 flex justify-center">
                <CreateRoomDialog />
              </div>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {list.map((room) => (
              <li key={room.id}>
                <RoomCard room={room} members={membersByRoom.get(room.id) ?? []} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function SignedOutLanding({ next, error }: { next?: string; error?: string }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Roomsplit</h1>
      <p className="mt-3 text-muted-foreground">
        Shared expenses and a live chore list for your place. Split a bill
        equally, with one person, or however you like — and see who owes what at
        a glance.
      </p>

      <ul className="my-8 space-y-3 text-sm">
        {[
          "Rooms for your apartment, trips for everything else",
          "Split equally, by exact amounts, or by percentage",
          "Chores with an assignee and a due date, updating live",
        ].map((line) => (
          <li key={line} className="flex gap-3">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="text-muted-foreground">{line}</span>
          </li>
        ))}
      </ul>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <SignInButton next={next} />

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Signing in links your expenses to your Google account, so everyone sees
        who paid for what.{" "}
        <Link href="/" className="underline underline-offset-2">
          Roomsplit
        </Link>{" "}
        never posts anything to your account.
      </p>
    </main>
  );
}
