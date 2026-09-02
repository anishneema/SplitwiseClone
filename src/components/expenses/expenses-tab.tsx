"use client";

import { useCallback, useMemo, useState } from "react";
import { ExpenseDialog, type DialogMember } from "@/components/expenses/expense-dialog";
import { MemberAvatar } from "@/components/member-avatar";
import { MoneyAmount } from "@/components/money-amount";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { useRoomRealtime } from "@/lib/hooks/use-room-realtime";
import { fetchBalances, fetchExpenses, shareFor, type ExpenseWithSplits } from "@/lib/queries";
import { formatCents } from "@/lib/money";
import { firstName, formatDateOnly, parseDateOnly } from "@/lib/format";
import type { RoomBalanceRow } from "@/lib/types/database";
import { LiveIndicator } from "@/components/rooms/live-indicator";

export function ExpensesTab({
  roomId,
  meId,
  members,
  initialExpenses,
  initialBalances,
}: {
  roomId: string;
  meId: string;
  members: DialogMember[];
  initialExpenses: ExpenseWithSplits[];
  initialBalances: RoomBalanceRow[];
}) {
  const [expenses, setExpenses] = useState(initialExpenses);
  const [balances, setBalances] = useState(initialBalances);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseWithSplits | null>(null);
  // Bumped on every open so the dialog remounts with fresh state.
  const [dialogKey, setDialogKey] = useState(0);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [nextExpenses, nextBalances] = await Promise.all([
      fetchExpenses(supabase, roomId),
      fetchBalances(supabase, roomId),
    ]);
    setExpenses(nextExpenses);
    setBalances(nextBalances);
  }, [roomId]);

  const status = useRoomRealtime(
    roomId,
    ["expenses", "expense_splits", "settlements"],
    refresh,
  );

  const nameById = useMemo(
    () => new Map(members.map((m) => [m.id, m.display_name])),
    [members],
  );
  const myNet = balances.find((b) => b.user_id === meId)?.net_cents ?? 0;

  // Grouped by date so the list reads like a statement rather than a flat feed.
  const groups = useMemo(() => {
    const byDate = new Map<string, ExpenseWithSplits[]>();
    for (const expense of expenses) {
      const list = byDate.get(expense.spent_at) ?? [];
      list.push(expense);
      byDate.set(expense.spent_at, list);
    }
    return [...byDate.entries()].sort(
      (a, b) => parseDateOnly(b[0]).getTime() - parseDateOnly(a[0]).getTime(),
    );
  }, [expenses]);

  function openAdd() {
    setEditing(null);
    setDialogKey((n) => n + 1);
    setDialogOpen(true);
  }

  function openEdit(expense: ExpenseWithSplits) {
    setEditing(expense);
    setDialogKey((n) => n + 1);
    setDialogOpen(true);
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {myNet === 0
              ? "You're all settled up"
              : myNet > 0
                ? "You're owed overall"
                : "You owe overall"}
          </p>
          {myNet === 0 ? (
            <p className="text-2xl font-semibold tracking-tight">{formatCents(0)}</p>
          ) : (
            <MoneyAmount cents={myNet} className="text-2xl tracking-tight" />
          )}
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator status={status} />
          <Button onClick={openAdd} className="hidden sm:inline-flex">
            Add expense
          </Button>
        </div>
      </div>

      {expenses.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">No expenses yet</p>
            <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
              Add the first one and it&apos;ll show up on everyone&apos;s screen
              straight away.
            </p>
            <Button onClick={openAdd} className="mt-5">
              Add expense
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map(([date, items]) => (
            <section key={date}>
              <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {formatDateOnly(date)}
              </h2>
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {items.map((expense) => (
                  <li key={expense.id}>
                    <ExpenseRow
                      expense={expense}
                      meId={meId}
                      members={members}
                      nameById={nameById}
                      onSelect={() => openEdit(expense)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Sticky action bar: this app is mostly used one-handed on a phone. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 pt-3 pb-safe backdrop-blur sm:hidden">
        <Button onClick={openAdd} size="lg" className="w-full">
          Add expense
        </Button>
      </div>

      <ExpenseDialog
        key={dialogKey}
        roomId={roomId}
        members={members}
        meId={meId}
        expense={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={refresh}
      />
    </>
  );
}

function ExpenseRow({
  expense,
  meId,
  members,
  nameById,
  onSelect,
}: {
  expense: ExpenseWithSplits;
  meId: string;
  members: DialogMember[];
  nameById: Map<string, string>;
  onSelect: () => void;
}) {
  const { net, involved } = shareFor(expense, meId);
  const payer = members.find((m) => m.id === expense.paid_by);
  const payerLabel =
    expense.paid_by === meId ? "You" : firstName(nameById.get(expense.paid_by) ?? "Someone");
  const personal = expense.split_type === "personal";

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/50"
    >
      <MemberAvatar
        userId={expense.paid_by}
        displayName={payer?.display_name ?? "Someone"}
        avatarUrl={payer?.avatar_url}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{expense.description}</p>
        <p className="truncate text-xs text-muted-foreground">
          {payerLabel} paid {formatCents(expense.amount_cents)}
          {personal ? " · personal" : ` · ${expense.splits.length} way split`}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {/*
          net === 0 while you are involved means you paid for it and your own
          share is the whole thing — money you spent on yourself, which is not
          the same as having nothing to do with it.
        */}
        {personal || !involved || net === 0 ? (
          <span className="text-xs text-muted-foreground">
            {personal ? "not split" : !involved ? "not involved" : "all yours"}
          </span>
        ) : (
          <>
            <span className="block text-xs text-muted-foreground">
              {net > 0 ? "you lent" : "you owe"}
            </span>
            <MoneyAmount cents={net} />
          </>
        )}
      </div>
    </button>
  );
}
