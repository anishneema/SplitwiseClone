"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createRoomAction } from "@/lib/actions/rooms";
import { cn } from "@/lib/utils";

export function CreateRoomDialog() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"room" | "trip">("room");
  const [restrictToEmails, setRestrictToEmails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    formData.set("kind", kind);
    formData.set("inviteMode", restrictToEmails ? "allowlist" : "link");

    startTransition(async () => {
      // On success the action redirects, so anything returned is an error.
      const result = await createRoomAction(formData);
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>New</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>Create a room or trip</DialogTitle>
            <DialogDescription>
              A room is an ongoing place, like your apartment. A trip is a
              one-off with its own group.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-5">
            <div className="grid grid-cols-2 gap-2">
              {(["room", "trip"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setKind(option)}
                  aria-pressed={kind === option}
                  className={cn(
                    "rounded-lg border px-3 py-3 text-left transition-colors",
                    kind === option
                      ? "border-primary bg-primary/10"
                      : "hover:bg-accent",
                  )}
                >
                  <span className="block text-sm font-medium capitalize">{option}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {option === "room" ? "Apartment, house" : "Vacation, weekend"}
                  </span>
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                required
                maxLength={80}
                autoFocus
                placeholder={kind === "room" ? "Apartment 4B" : "Miami, March"}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="emails">Invite roommates (optional)</Label>
              <Textarea
                id="emails"
                name="emails"
                rows={2}
                placeholder="nav@gmail.com, sam@gmail.com"
              />
              <p className="text-xs text-muted-foreground">
                You&apos;ll also get a link you can just send them.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={restrictToEmails}
                onChange={(e) => setRestrictToEmails(e.target.checked)}
              />
              <span className="text-sm">
                <span className="block font-medium">Only let invited emails in</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Otherwise anyone with the link can join. You can change this
                  later.
                </span>
              </span>
            </label>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending} className="w-full sm:w-auto">
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
