import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Shown when someone opens a room they can't see — usually because a room URL
 * got shared instead of an invite link. A room URL cannot admit anybody: only
 * `/join/<code>` can, so the fix is always to get that link.
 */
export default function RoomNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center px-5 py-12">
      <Card className="w-full">
        <CardContent className="py-8">
          <h1 className="text-xl font-semibold">You&apos;re not in this room</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            You&apos;re signed in, but this room isn&apos;t shared with you — or it
            no longer exists.
          </p>
          <div className="mt-5 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
            <p className="font-medium">Ask for the invite link</p>
            <p className="mt-1 text-muted-foreground">
              A link like <code className="font-mono text-xs">/rooms/…</code>{" "}
              can&apos;t add you. Whoever shared it should tap{" "}
              <span className="font-medium text-foreground">Invite</span> at the
              top of the room and send you that link instead.
            </p>
          </div>
          <Button render={<Link href="/" />} className="mt-6 w-full">
            Go to my rooms
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
