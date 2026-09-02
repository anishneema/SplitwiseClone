"use client";

import { useState } from "react";
import { toast } from "sonner";
import { MemberAvatar } from "@/components/member-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { centsToInput, parseDollarsToCents } from "@/lib/money";
import { firstName, todayDateOnly } from "@/lib/format";
import type { Transfer } from "@/lib/balances";
import { cn } from "@/lib/utils";

type Member = { id: string; display_name: string; avatar_url: string | null };

/**
 * Records a real-world payment between two people. This does not move money
 * anywhere — it just tells the app that cash already changed hands.
 */
export function SettleUpDialog({
  roomId,
  meId,
  members,
  prefill,
  open,
  onOpenChange,
  onSaved,
}: {
  roomId: string;
  meId: string;
  members: Member[];
  prefill: Transfer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  /**
   * Initialized from props, not synced in an effect. The parent remounts this
   * with a fresh `key` each time the dialog opens, which resets the form.
   */
  const [fromUser, setFromUser] = useState(prefill?.from ?? meId);
  const [toUser, setToUser] = useState(
    prefill?.to ?? members.find((m) => m.id !== meId)?.id ?? "",
  );
  const [amountInput, setAmountInput] = useState(
    prefill ? centsToInput(prefill.amountCents) : "",
  );
  const [settledAt, setSettledAt] = useState(todayDateOnly());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = parseDollarsToCents(amountInput);
  const problem =
    !fromUser || !toUser
      ? "Pick who paid and who was paid."
      : fromUser === toUser
        ? "Those are the same person."
        : amountCents === null
          ? "Enter an amount."
          : amountCents <= 0
            ? "The amount has to be more than $0."
            : null;

  async function save() {
    if (problem || amountCents === null) return;
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.from("settlements").insert({
      room_id: roomId,
      from_user: fromUser,
      to_user: toUser,
      amount_cents: amountCents,
      settled_at: settledAt,
      note: note.trim() || null,
      created_by: meId,
    });

    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }

    toast.success("Payment recorded");
    onSaved?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settle up</DialogTitle>
          <DialogDescription>
            Record a payment that already happened in real life — cash, Venmo,
            whatever.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-5">
          <PersonPicker
            legend="Who paid"
            members={members}
            meId={meId}
            selected={fromUser}
            onSelect={setFromUser}
          />
          <PersonPicker
            legend="Who received it"
            members={members}
            meId={meId}
            selected={toUser}
            onSelect={setToUser}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="settle-amount">Amount</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  id="settle-amount"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="pl-7 tabular-nums"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settle-date">Date</Label>
              <Input
                id="settle-date"
                type="date"
                value={settledAt}
                onChange={(e) => setSettledAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="settle-note">Note (optional)</Label>
            <Input
              id="settle-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Venmo"
              maxLength={120}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-3 sm:items-center">
          {problem ? (
            <span className="text-xs text-muted-foreground">{problem}</span>
          ) : null}
          <Button onClick={save} disabled={saving || Boolean(problem)}>
            {saving ? "Saving…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PersonPicker({
  legend,
  members,
  meId,
  selected,
  onSelect,
}: {
  legend: string;
  members: Member[];
  meId: string;
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {members.map((member) => (
          <button
            key={member.id}
            type="button"
            onClick={() => onSelect(member.id)}
            aria-pressed={selected === member.id}
            className={cn(
              "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors",
              selected === member.id
                ? "border-primary bg-primary/10 font-medium"
                : "hover:bg-accent",
            )}
          >
            <MemberAvatar
              userId={member.id}
              displayName={member.display_name}
              avatarUrl={member.avatar_url}
              className="size-6"
            />
            {member.id === meId ? "You" : firstName(member.display_name)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
