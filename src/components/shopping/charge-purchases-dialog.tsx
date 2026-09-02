"use client";

import { useState } from "react";
import { toast } from "sonner";
import { MemberAvatar } from "@/components/member-avatar";
import { describeFor } from "@/components/member-multi-picker";
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
import { centsToInput, formatCents, parseDollarsToCents, splitEqual } from "@/lib/money";
import { todayDateOnly } from "@/lib/format";
import type { ChargeLine, ShoppingItem } from "@/lib/types/database";

type Member = { id: string; display_name: string; avatar_url: string | null };

/**
 * Prices a finished shopping trip and turns it into one expense.
 *
 * Only the price is asked for here. Who owes what was decided when each item
 * was requested, so this is a receipt to copy out, not a set of decisions to
 * make — which is the whole reason "who it's for" lives on the item.
 *
 * The preview below uses the same splitEqual() the RPC's SQL mirrors, so what
 * you see is what lands in expense_splits, down to the odd penny.
 */
export function ChargePurchasesDialog({
  roomId,
  meId,
  members,
  nameById,
  items,
  open,
  onOpenChange,
  onSaved,
}: {
  roomId: string;
  meId: string;
  members: Member[];
  nameById: Map<string, string>;
  items: ShoppingItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  /**
   * Initialized from props rather than synced in an effect: the parent gives
   * this a fresh `key` each time it opens. A price already on an item — because
   * its charge was deleted and it came back to the queue — prefills.
   */
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map((i) => [i.id, i.price_cents !== null ? centsToInput(i.price_cents) : ""]),
    ),
  );
  const [description, setDescription] = useState("Shopping list");
  const [spentAt, setSpentAt] = useState(todayDateOnly());
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /**
   * Blank means "not this time" rather than free: the item stays in the queue
   * for the next trip. Anything that isn't readable as an amount is an error,
   * because silently dropping a typo would understate the charge.
   */
  function resolve(): {
    lines: ChargeLine[];
    owed: Record<string, number>;
    total: number;
    problem: string | null;
  } {
    const lines: ChargeLine[] = [];
    const owed: Record<string, number> = {};

    for (const item of items) {
      const raw = prices[item.id] ?? "";
      if (raw.trim() === "") continue;

      const cents = parseDollarsToCents(raw);
      if (cents === null) {
        return { lines: [], owed: {}, total: 0, problem: `"${raw}" isn't an amount I can read.` };
      }
      if (cents <= 0) {
        return {
          lines: [],
          owed: {},
          total: 0,
          problem: `${item.name} needs a price above $0, or leave it blank.`,
        };
      }

      lines.push({ item_id: item.id, price_cents: cents });
      const share = splitEqual(cents, item.for_users);
      for (const [userId, amount] of Object.entries(share)) {
        owed[userId] = (owed[userId] ?? 0) + amount;
      }
    }

    if (lines.length === 0) {
      return { lines, owed, total: 0, problem: "Put a price against at least one thing." };
    }
    if (description.trim().length === 0) {
      return { lines, owed, total: 0, problem: "Give the charge a description." };
    }

    return {
      lines,
      owed,
      total: lines.reduce((sum, l) => sum + l.price_cents, 0),
      problem: null,
    };
  }

  const { lines, owed, total, problem } = resolve();

  /**
   * Your own share is money you spent on yourself, not a debt. Splitting the
   * preview this way is the point: listing yourself under "who owes" alongside
   * everyone else reads as though the app is charging you for your own
   * shopping, which it isn't — your share cancels against what you paid.
   */
  const myShare = owed[meId] ?? 0;
  const owedToMe = total - myShare;

  async function save() {
    if (problem) return;
    setSaving(true);
    setSubmitError(null);

    const supabase = createClient();
    const { error } = await supabase.rpc("charge_shopping_items", {
      p_room_id: roomId,
      p_description: description.trim(),
      p_spent_at: spentAt,
      p_lines: lines,
    });

    if (error) {
      setSubmitError(error.message);
      setSaving(false);
      return;
    }

    toast.success(
      `${formatCents(total)} added to expenses${
        lines.length < items.length ? ` · ${items.length - lines.length} left on the list` : ""
      }`,
    );
    onSaved?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What did it come to?</DialogTitle>
          <DialogDescription>
            You bought {items.length === 1 ? "this" : `these ${items.length} things`}. Add
            the prices and it becomes one charge, split the way each was asked for.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-5">
          <ul className="divide-y rounded-lg border">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {item.name}
                    {item.quantity ? (
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        {item.quantity}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {describeFor(item.for_users, meId, nameById, members.length)}
                  </p>
                </div>
                <div className="relative w-28 shrink-0">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    id={`price-${item.id}`}
                    aria-label={`Price of ${item.name}`}
                    value={prices[item.id] ?? ""}
                    onChange={(e) =>
                      setPrices((current) => ({ ...current, [item.id]: e.target.value }))
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-9 pl-6 text-right tabular-nums"
                  />
                </div>
              </li>
            ))}
          </ul>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="charge-description">Description</Label>
              <Input
                id="charge-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={120}
                placeholder="Shopping list"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="charge-date">Date</Label>
              <Input
                id="charge-date"
                type="date"
                value={spentAt}
                onChange={(e) => setSpentAt(e.target.value)}
              />
            </div>
          </div>

          {lines.length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">What comes back to you</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {formatCents(owedToMe)} of {formatCents(total)}
                </span>
              </div>

              {owedToMe > 0 ? (
                <ul className="divide-y rounded-lg border">
                  {members
                    .filter((member) => member.id !== meId && (owed[member.id] ?? 0) > 0)
                    .map((member) => (
                      <li key={member.id} className="flex items-center gap-3 px-3 py-2">
                        <MemberAvatar
                          userId={member.id}
                          displayName={member.display_name}
                          avatarUrl={member.avatar_url}
                          className="size-7"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {member.display_name} owes you
                        </span>
                        <span className="shrink-0 text-sm tabular-nums">
                          {formatCents(owed[member.id])}
                        </span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="rounded-lg border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                  Nothing — all of this was for you. It gets logged as your own
                  spending and doesn&apos;t change anyone&apos;s balance.
                </p>
              )}

              {myShare > 0 && owedToMe > 0 ? (
                <p className="text-xs text-muted-foreground">
                  The other {formatCents(myShare)} is your own share. You&apos;re not
                  charged for it — you already paid it.
                </p>
              ) : null}
            </div>
          ) : null}

          {submitError ? (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          ) : null}
        </div>

        <DialogFooter className="sticky bottom-0 -mx-6 gap-3 border-t bg-background px-6 py-4 sm:items-center sm:justify-end">
          {problem ? (
            <span className="text-right text-xs text-muted-foreground">{problem}</span>
          ) : null}
          <Button type="button" onClick={save} disabled={saving || Boolean(problem)}>
            {saving ? "Adding…" : `Add ${formatCents(total)} charge`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
