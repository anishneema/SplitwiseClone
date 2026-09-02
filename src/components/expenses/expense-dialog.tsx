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
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import {
  centsToInput,
  formatCents,
  parseDollarsToCents,
  splitByPercent,
  splitEqual,
} from "@/lib/money";
import { firstName, todayDateOnly } from "@/lib/format";
import type { ExpenseWithSplits } from "@/lib/queries";
import type { SplitInput, SplitType } from "@/lib/types/database";
import { cn } from "@/lib/utils";

export type DialogMember = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

const MODES: Array<{ value: SplitType; label: string; hint: string }> = [
  { value: "equal", label: "Equally", hint: "Split evenly between everyone selected" },
  { value: "exact", label: "Exact amounts", hint: "Type what each person owes" },
  { value: "percent", label: "Percentages", hint: "Split by share of the total" },
  { value: "personal", label: "Just me", hint: "Log it without splitting" },
];

export function ExpenseDialog({
  roomId,
  members,
  meId,
  expense,
  open,
  onOpenChange,
  onSaved,
}: {
  roomId: string;
  members: DialogMember[];
  meId: string;
  expense?: ExpenseWithSplits | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const editing = Boolean(expense);

  /**
   * Only the person who entered a charge may change or remove it. The database
   * is what enforces that -- the expenses_delete policy and the authorship
   * check inside update_expense() -- so for everyone else this dialog opens
   * read-only rather than offering controls whose write would be refused.
   */
  const canEdit = !expense || expense.created_by === meId;

  /**
   * State is initialized straight from props rather than synced in an effect.
   * The parent gives this component a fresh `key` every time the dialog opens,
   * so React remounts it and these initializers run again — which is the
   * supported way to reset form state, and avoids the cascading renders an
   * effect-based reset causes.
   */
  const [description, setDescription] = useState(expense?.description ?? "");
  const [amountInput, setAmountInput] = useState(
    expense ? centsToInput(expense.amount_cents) : "",
  );
  const [paidBy, setPaidBy] = useState(expense?.paid_by ?? meId);
  const [spentAt, setSpentAt] = useState(expense?.spent_at ?? todayDateOnly());
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [mode, setMode] = useState<SplitType>(expense?.split_type ?? "equal");
  const [participants, setParticipants] = useState<string[]>(() =>
    expense ? expense.splits.map((s) => s.user_id) : members.map((m) => m.id),
  );
  const [exactInputs, setExactInputs] = useState<Record<string, string>>(() =>
    expense
      ? Object.fromEntries(
          expense.splits.map((s) => [s.user_id, centsToInput(s.owed_cents)]),
        )
      : {},
  );
  const [percentInputs, setPercentInputs] = useState<Record<string, string>>(() =>
    expense
      ? Object.fromEntries(
          expense.splits.map((s) => [
            s.user_id,
            ((s.owed_cents / expense.amount_cents) * 100)
              .toFixed(2)
              .replace(/\.00$/, ""),
          ]),
        )
      : {},
  );
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const amountCents = parseDollarsToCents(amountInput);
  const nameById = new Map(members.map((m) => [m.id, m.display_name]));
  const authorLabel = expense
    ? firstName(nameById.get(expense.created_by) ?? "Someone")
    : "";

  /**
   * Every mode resolves to the same `{ user_id, owed_cents }` list that the
   * create_expense/update_expense RPCs take, which is also what the database
   * validates. `problem` is the single source of truth for whether Save is
   * allowed and what to tell the user.
   */
  function resolveSplits(): { splits: SplitInput[]; problem: string | null } {
    if (description.trim().length === 0) return { splits: [], problem: "Add a description." };
    if (amountCents === null) return { splits: [], problem: "Enter an amount." };
    if (amountCents <= 0) return { splits: [], problem: "The amount has to be more than $0." };

    if (mode === "personal") {
      return { splits: [{ user_id: paidBy, owed_cents: amountCents }], problem: null };
    }

    if (mode === "equal") {
      if (participants.length === 0) {
        return { splits: [], problem: "Pick at least one person to split with." };
      }
      const map = splitEqual(amountCents, participants);
      return {
        splits: participants.map((id) => ({ user_id: id, owed_cents: map[id] })),
        problem: null,
      };
    }

    if (mode === "exact") {
      const entries: SplitInput[] = [];
      for (const member of members) {
        const raw = exactInputs[member.id];
        if (!raw || raw.trim() === "") continue;
        const cents = parseDollarsToCents(raw);
        if (cents === null) {
          return { splits: [], problem: `"${raw}" isn't an amount I can read.` };
        }
        if (cents < 0) return { splits: [], problem: "Amounts can't be negative." };
        if (cents > 0) entries.push({ user_id: member.id, owed_cents: cents });
      }
      if (entries.length === 0) {
        return { splits: [], problem: "Enter what at least one person owes." };
      }
      const assigned = entries.reduce((sum, e) => sum + e.owed_cents, 0);
      const diff = amountCents - assigned;
      if (diff > 0) {
        return { splits: [], problem: `${formatCents(diff)} still to assign.` };
      }
      if (diff < 0) {
        return { splits: [], problem: `${formatCents(-diff)} over the total.` };
      }
      return { splits: entries, problem: null };
    }

    // percent
    const percents: Record<string, number> = {};
    let total = 0;
    for (const member of members) {
      const raw = percentInputs[member.id];
      if (!raw || raw.trim() === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        return { splits: [], problem: `"${raw}" isn't a percentage I can read.` };
      }
      if (value > 0) {
        percents[member.id] = value;
        total += value;
      }
    }
    if (Object.keys(percents).length === 0) {
      return { splits: [], problem: "Enter a percentage for at least one person." };
    }
    // Tolerance covers the float error in sums like 33.33 + 33.33 + 33.34.
    if (Math.abs(total - 100) > 0.001) {
      return {
        splits: [],
        problem:
          total < 100
            ? `${(100 - total).toFixed(2).replace(/\.?0+$/, "")}% left to assign.`
            : `${(total - 100).toFixed(2).replace(/\.?0+$/, "")}% over 100%.`,
      };
    }
    const map = splitByPercent(amountCents, percents);
    return {
      splits: Object.entries(map).map(([id, cents]) => ({ user_id: id, owed_cents: cents })),
      problem: null,
    };
  }

  // Cheap enough to recompute each render, and always consistent with the form.
  const { splits, problem } = resolveSplits();
  const splitPreview = new Map(splits.map((s) => [s.user_id, s.owed_cents]));

  async function save() {
    if (!canEdit || problem || amountCents === null) return;
    setSaving(true);
    setSubmitError(null);

    const supabase = createClient();
    const args = {
      p_description: description.trim(),
      p_amount_cents: amountCents,
      p_paid_by: paidBy,
      p_spent_at: spentAt,
      p_split_type: mode,
      p_notes: notes.trim() || null,
      p_splits: splits,
    };

    const { error } = expense
      ? await supabase.rpc("update_expense", { p_expense_id: expense.id, ...args })
      : await supabase.rpc("create_expense", { p_room_id: roomId, ...args });

    if (error) {
      setSubmitError(error.message);
      setSaving(false);
      return;
    }

    toast.success(editing ? "Expense updated" : "Expense added");
    onSaved?.();
    onOpenChange(false);
  }

  async function remove() {
    if (!expense || !canEdit) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("expenses").delete().eq("id", expense.id);
    if (error) {
      setSubmitError(error.message);
      setSaving(false);
      return;
    }
    toast.success("Expense deleted");
    onSaved?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {!canEdit ? "Expense details" : editing ? "Edit expense" : "Add an expense"}
          </DialogTitle>
          <DialogDescription>
            {!canEdit
              ? `${authorLabel} added this one. Only they can change or delete it.`
              : editing
                ? "Changes update everyone's balances right away."
                : "Everyone in the room sees this immediately."}
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={!canEdit} className="space-y-5 py-5">
          <div className="space-y-2">
            <Label htmlFor="expense-description">What was it for?</Label>
            <Input
              id="expense-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Groceries"
              maxLength={120}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="expense-amount">Amount</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  id="expense-amount"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="pl-7 text-lg tabular-nums"
                  // `decimal` gives phones a numeric keypad that still has a
                  // decimal point, unlike inputMode="numeric".
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="expense-date">Date</Label>
              <Input
                id="expense-date"
                type="date"
                value={spentAt}
                onChange={(e) => setSpentAt(e.target.value)}
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Paid by</legend>
            <div className="flex flex-wrap gap-2">
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setPaidBy(member.id)}
                  aria-pressed={paidBy === member.id}
                  className={cn(
                    "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors",
                    paidBy === member.id
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

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">How to split it</legend>
            <div className="grid grid-cols-2 gap-2">
              {MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMode(option.value)}
                  aria-pressed={mode === option.value}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    mode === option.value
                      ? "border-primary bg-primary/10"
                      : "hover:bg-accent",
                  )}
                >
                  <span className="block font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                    {option.hint}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          {mode === "personal" ? (
            <p className="rounded-lg border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
              Logged against{" "}
              <span className="font-medium text-foreground">
                {paidBy === meId ? "you" : firstName(nameById.get(paidBy) ?? "")}
              </span>{" "}
              only. It shows up in the expense list but doesn&apos;t change anyone&apos;s
              balance.
            </p>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">
                  {mode === "equal" ? "Split between" : "Who owes what"}
                </span>
                {mode === "equal" && participants.length > 0 && amountCents ? (
                  <button
                    type="button"
                    onClick={() =>
                      setParticipants(
                        participants.length === members.length
                          ? [meId]
                          : members.map((m) => m.id),
                      )
                    }
                    className="text-xs text-primary hover:underline"
                  >
                    {participants.length === members.length ? "Just me" : "Everyone"}
                  </button>
                ) : null}
              </div>

              <ul className="divide-y rounded-lg border">
                {members.map((member) => {
                  const selected = participants.includes(member.id);
                  const share = splitPreview.get(member.id);

                  return (
                    <li key={member.id}>
                      {mode === "equal" ? (
                        <button
                          type="button"
                          onClick={() =>
                            setParticipants((current) =>
                              current.includes(member.id)
                                ? current.filter((id) => id !== member.id)
                                : [...current, member.id],
                            )
                          }
                          aria-pressed={selected}
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "grid size-5 shrink-0 place-items-center rounded border",
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-input",
                            )}
                          >
                            {selected ? <CheckMark /> : null}
                          </span>
                          <MemberAvatar
                            userId={member.id}
                            displayName={member.display_name}
                            avatarUrl={member.avatar_url}
                            className="size-7"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {member.id === meId ? "You" : member.display_name}
                          </span>
                          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                            {selected && share !== undefined ? formatCents(share) : "—"}
                          </span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-3 px-3 py-2">
                          <MemberAvatar
                            userId={member.id}
                            displayName={member.display_name}
                            avatarUrl={member.avatar_url}
                            className="size-7"
                          />
                          <label
                            htmlFor={`share-${member.id}`}
                            className="min-w-0 flex-1 truncate text-sm"
                          >
                            {member.id === meId ? "You" : member.display_name}
                          </label>
                          {mode === "exact" ? (
                            <div className="relative w-28 shrink-0">
                              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                $
                              </span>
                              <Input
                                id={`share-${member.id}`}
                                value={exactInputs[member.id] ?? ""}
                                onChange={(e) =>
                                  setExactInputs((c) => ({ ...c, [member.id]: e.target.value }))
                                }
                                inputMode="decimal"
                                placeholder="0.00"
                                className="h-9 pl-6 text-right tabular-nums"
                              />
                            </div>
                          ) : (
                            <div className="flex shrink-0 items-center gap-2">
                              <div className="relative w-20">
                                <Input
                                  id={`share-${member.id}`}
                                  value={percentInputs[member.id] ?? ""}
                                  onChange={(e) =>
                                    setPercentInputs((c) => ({
                                      ...c,
                                      [member.id]: e.target.value,
                                    }))
                                  }
                                  inputMode="decimal"
                                  placeholder="0"
                                  className="h-9 pr-6 text-right tabular-nums"
                                />
                                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                  %
                                </span>
                              </div>
                              <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                                {share !== undefined ? formatCents(share) : ""}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {mode === "equal" && participants.length === 1 ? (
                <p className="text-xs text-muted-foreground">
                  One person selected — this is the &ldquo;split with just one
                  person&rdquo; case.
                </p>
              ) : null}
            </div>
          )}

          <details className="group">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
              Add a note
            </summary>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-2"
              placeholder="Anything worth remembering later"
            />
          </details>

          {submitError ? (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          ) : null}
        </fieldset>

        <DialogFooter className="sticky bottom-0 -mx-6 gap-2 border-t bg-background px-6 py-4 sm:justify-between">
          {canEdit ? (
            <>
              {editing ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={remove}
                  disabled={saving}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  Delete
                </Button>
              ) : (
                <span className="hidden sm:block" />
              )}
              <div className="flex flex-1 items-center justify-end gap-3">
                {problem ? (
                  <span className="text-right text-xs text-muted-foreground">{problem}</span>
                ) : null}
                <Button type="button" onClick={save} disabled={saving || Boolean(problem)}>
                  {saving ? "Saving…" : editing ? "Save" : "Add expense"}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2.5 6.5 4.8 8.8 9.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
