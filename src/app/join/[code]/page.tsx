import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInButton } from "@/components/sign-in-button";
import { SetupNotice } from "@/components/setup-notice";
import { JoinButton } from "@/components/rooms/join-button";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export default async function JoinPage({ params }: PageProps<"/join/[code]">) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { code } = await params;
  const user = await getCurrentUser();
  const supabase = await createSupabaseServerClient();

  // peek_room_by_code() is SECURITY DEFINER precisely so we can name the room
  // before someone is a member of it.
  const { data: peeked } = await supabase.rpc("peek_room_by_code", { p_code: code });
  const room = peeked?.[0];

  if (!room) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">That invite link isn&apos;t valid</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been mistyped, or the room may have been deleted. Ask
          whoever sent it for a fresh link.
        </p>
        <Button render={<Link href="/" />} className="mt-6 w-full">
          Go home
        </Button>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">You&apos;ve been invited to</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{room.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {room.member_count} {room.member_count === 1 ? "member" : "members"} ·{" "}
          {room.kind === "trip" ? "Trip" : "Room"}
        </p>
        <p className="mt-6 text-sm text-muted-foreground">
          Sign in with Google to join. Your name and photo are how your roommates
          will recognise you.
        </p>
        <SignInButton className="mt-4" next={`/join/${code}`} label="Sign in and join" />
      </Shell>
    );
  }

  // Already a member? Skip the interstitial entirely.
  const { data: existing } = await supabase
    .from("rooms")
    .select("id")
    .eq("invite_code", code)
    .maybeSingle();

  if (existing) redirect(`/rooms/${existing.id}`);

  return (
    <Shell>
      <p className="text-sm text-muted-foreground">You&apos;ve been invited to</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{room.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {room.member_count} {room.member_count === 1 ? "member" : "members"} ·{" "}
        {room.kind === "trip" ? "Trip" : "Room"}
      </p>
      {room.invite_mode === "allowlist" ? (
        <p className="mt-4 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
          This {room.kind} only accepts invited email addresses. You&apos;re
          signed in as{" "}
          <span className="font-medium text-foreground">{user.email}</span>.
        </p>
      ) : null}
      <JoinButton code={code} className="mt-6" />
      <Button
        variant="ghost"
        render={<Link href="/" />}
        className="mt-2 w-full text-muted-foreground"
      >
        Not now
      </Button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center px-5 py-12">
      <Card className="w-full">
        <CardContent className="py-8">{children}</CardContent>
      </Card>
    </main>
  );
}
