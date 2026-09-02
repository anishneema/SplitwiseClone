"use client";

import { useState } from "react";
import { toast } from "sonner";

/**
 * Puts the invite link one tap from every screen in the room.
 *
 * Without this, the obvious way to share a room is to copy the URL out of the
 * address bar — which sends people to `/rooms/<id>`, a room they aren't a
 * member of, where all they can be told is "no". The invite link is the only
 * URL that actually lets someone in.
 */
export function InviteButton({
  inviteCode,
  roomName,
}: {
  inviteCode: string;
  roomName: string;
}) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/join/${inviteCode}`;

    // On a phone this opens the real share sheet (Messages, WhatsApp…), which
    // is how these links actually get sent.
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${roomName}`, url });
        return;
      } catch (e) {
        // A user cancelling the sheet is not an error worth reporting.
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Invite link copied", {
        description: "Anyone who opens it can join this room.",
      });
    } catch {
      toast.error("Couldn't copy", { description: url });
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="ml-1 shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {copied ? "Copied" : "Invite"}
    </button>
  );
}
