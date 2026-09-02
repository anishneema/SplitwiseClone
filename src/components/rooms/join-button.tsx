"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { joinRoomAction } from "@/lib/actions/rooms";

export function JoinButton({ code, className }: { code: string; className?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className={className}>
      <Button
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            // On success the action redirects into the room.
            const result = await joinRoomAction(code);
            if (result && !result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Joining…" : "Join"}
      </Button>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
