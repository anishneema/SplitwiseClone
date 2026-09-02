"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MemberAvatar } from "@/components/member-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  addInviteAction,
  deleteRoomAction,
  removeInviteAction,
  removeMemberAction,
  updateRoomAction,
} from "@/lib/actions/rooms";
import type { Profile, Room, RoomInvite, RoomMember } from "@/lib/types/database";
import { cn } from "@/lib/utils";

export function RoomSettings({
  room,
  members,
  invites,
  me,
  isOwner,
  inviteUrl,
}: {
  room: Room;
  members: Array<RoomMember & { profile: Profile }>;
  invites: RoomInvite[];
  me: Profile;
  isOwner: boolean;
  inviteUrl: string;
}) {
  const [name, setName] = useState(room.name);
  const [inviteMode, setInviteMode] = useState(room.invite_mode);
  const [emails, setEmails] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string } | void>, success?: string) {
    startTransition(async () => {
      const result = await action();
      if (result && !result.ok) {
        toast.error(result.error ?? "That didn't work.");
        return;
      }
      if (success) toast.success(success);
    });
  }

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  }

  function formDataOf(entries: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
            <Button variant="outline" onClick={copyInviteLink}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {inviteMode === "link"
              ? "Anyone who opens this link and signs in with Google joins the room."
              : "Only the email addresses below can use this link."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Who can join</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  value: "link" as const,
                  label: "Anyone with the link",
                  hint: "Easiest for roommates you trust",
                },
                {
                  value: "allowlist" as const,
                  label: "Only invited emails",
                  hint: "The link alone isn't enough",
                },
              ]
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={!isOwner}
                onClick={() => {
                  setInviteMode(option.value);
                  run(
                    () =>
                      updateRoomAction(
                        formDataOf({
                          roomId: room.id,
                          name,
                          inviteMode: option.value,
                        }),
                      ),
                    "Updated",
                  );
                }}
                aria-pressed={inviteMode === option.value}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-60",
                  inviteMode === option.value
                    ? "border-primary bg-primary/10"
                    : "enabled:hover:bg-accent",
                )}
              >
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {option.hint}
                </span>
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-emails">Invited emails</Label>
            <div className="flex gap-2">
              <Input
                id="invite-emails"
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                placeholder="sam@gmail.com"
              />
              <Button
                variant="outline"
                disabled={pending || emails.trim().length === 0}
                onClick={() =>
                  run(async () => {
                    const result = await addInviteAction(
                      formDataOf({ roomId: room.id, emails }),
                    );
                    if (result.ok) setEmails("");
                    return result;
                  }, "Invite added")
                }
              >
                Add
              </Button>
            </div>
            {invites.length > 0 ? (
              <ul className="divide-y rounded-lg border">
                {invites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex items-center gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{invite.email}</span>
                    {invite.accepted_at ? (
                      <Badge variant="secondary">joined</Badge>
                    ) : (
                      <Badge variant="outline">pending</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            removeInviteAction(
                              formDataOf({ roomId: room.id, inviteId: invite.id }),
                            ),
                          "Invite removed",
                        )
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                No invited emails yet.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {members.map((member) => (
              <li key={member.user_id} className="flex items-center gap-3 py-2.5">
                <MemberAvatar
                  userId={member.user_id}
                  displayName={member.profile.display_name}
                  avatarUrl={member.profile.avatar_url}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.profile.display_name}
                    {member.user_id === me.id ? " (you)" : ""}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {member.profile.email}
                  </p>
                </div>
                {member.role === "owner" ? (
                  <Badge variant="secondary">owner</Badge>
                ) : null}
                {isOwner && member.user_id !== me.id ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          removeMemberAction(
                            formDataOf({ roomId: room.id, userId: member.user_id }),
                          ),
                        "Member removed",
                      )
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {room.kind === "trip" ? "Trip" : "Room"} name
          </CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isOwner}
            maxLength={80}
          />
          <Button
            variant="outline"
            disabled={!isOwner || pending || name.trim() === room.name}
            onClick={() =>
              run(
                () =>
                  updateRoomAction(formDataOf({ roomId: room.id, name, inviteMode })),
                "Renamed",
              )
            }
          >
            Save
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Leave this {room.kind}. You&apos;ll need a fresh invite to come back.
            </p>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() =>
                  removeMemberAction(formDataOf({ roomId: room.id, userId: me.id })),
                )
              }
            >
              Leave
            </Button>
          </div>
          {isOwner ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <p className="text-sm text-muted-foreground">
                Delete it for everyone, including all expenses and chores. This
                cannot be undone.
              </p>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Delete "${room.name}" for everyone? All expenses, balances and chores go with it. This cannot be undone.`,
                    )
                  ) {
                    return;
                  }
                  run(() => deleteRoomAction(formDataOf({ roomId: room.id })));
                }}
              >
                Delete {room.kind}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
