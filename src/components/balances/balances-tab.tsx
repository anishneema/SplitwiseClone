"use client";

import { useCallback, useMemo, useState } from "react";
import { MemberAvatar } from "@/components/member-avatar";
import { MoneyAmount } from "@/components/money-amount";
import { SettleUpDialog } from "@/components/balances/settle-up-dialog";
import { LiveIndicator } from "@/components/rooms/live-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { useRoomRealtime } from "@/lib/hooks/use-room-realtime";
import { fetchBalances, fetchSettlements } from "@/lib/queries";
import { simplifyDebts, type Transfer } from "@/lib/balances";
import { formatCents } from "@/lib/money";
import { firstName, formatDateOnly } from "@/lib/format";
import type { RoomBalanceRow, Settlement } from "@/lib/types/database";

type Member = { id: string; display_name: string; avatar_url: string | null };

export function BalancesTab({
  roomId,
  meId,
  members,
  initialBalances,
  initialSettlements,
}: {
  roomId: string;
  meId: string;
  members: Member[];
  initialBalances: RoomBalanceRow[];
  initialSettlements: Settlement[];
}) {
  const [balances, setBalances] = useState(initialBalances);
  const [settlements, setSettlements] = useState(initialSettlements);
  const [prefill, setPrefill] = useState<Transfer | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Bumped on every open so the dialog remounts with fresh state.
  const [dialogKey, setDialogKey] = useState(0);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [nextBalances, nextSettlements] = await Promise.all([
      fetchBalances(supabase, roomId),
      fetchSettlements(supabase, roomId),
    ]);
    setBalances(nextBalances);
    setSettlements(nextSettlements);
  }, [roomId]);

  const status = useRoomRealtime(
    roomId,
    ["expenses", "expense_splits", "settlements"],
    refresh,
  );

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const nameOf = useCallback(
    (id: string, capitalized = false) =>
      id === meId
        ? capitalized
          ? "You"
          : "you"
        : firstName(memberById.get(id)?.display_name ?? "Someone"),
    [meId, memberById],
  );

  const transfers = useMemo(
    () =>
      simplifyDebts(
        balances.map((b) => ({ userId: b.user_id, netCents: b.net_cents })),
      ),
    [balances],
  );

  const myTransfers = transfers.filter((t) => t.from === meId || t.to === meId);
  const otherTransfers = transfers.filter((t) => t.from !== meId && t.to !== meId);
  const allSquare = transfers.length === 0;

  function openSettle(transfer?: Transfer) {
    setPrefill(transfer ?? null);
    setDialogKey((n) => n + 1);
    setDialogOpen(true);
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Balances</h1>
        <div className="flex items-center gap-3">
          <LiveIndicator status={status} />
          <Button variant="outline" onClick={() => openSettle()}>
            Settle up
          </Button>
        </div>
      </div>

      {allSquare ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">Everyone&apos;s square</p>
            <p className="mt-2 text-sm text-muted-foreground">
              No one owes anyone anything right now.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {myTransfers.length > 0 ? (
            <section>
              <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                You
              </h2>
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {myTransfers.map((transfer) => (
                  <li key={`${transfer.from}-${transfer.to}`}>
                    <TransferRow
                      transfer={transfer}
                      meId={meId}
                      memberById={memberById}
                      nameOf={nameOf}
                      onSettle={() => openSettle(transfer)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {otherTransfers.length > 0 ? (
            <section>
              <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Between others
              </h2>
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {otherTransfers.map((transfer) => (
                  <li key={`${transfer.from}-${transfer.to}`}>
                    <TransferRow
                      transfer={transfer}
                      meId={meId}
                      memberById={memberById}
                      nameOf={nameOf}
                      onSettle={() => openSettle(transfer)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="px-1 text-xs text-muted-foreground">
            These are the fewest payments that clear everyone at once, so they
            may not match who originally paid whom.
          </p>
        </div>
      )}

      <section className="mt-8">
        <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Per person
        </h2>
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {balances
            .slice()
            .sort((a, b) => b.net_cents - a.net_cents)
            .map((balance) => {
              const member = memberById.get(balance.user_id);
              return (
                <li
                  key={balance.user_id}
                  className="flex items-center gap-3 px-3 py-3"
                >
                  <MemberAvatar
                    userId={balance.user_id}
                    displayName={member?.display_name ?? "Someone"}
                    avatarUrl={member?.avatar_url}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {balance.user_id === meId
                        ? "You"
                        : (member?.display_name ?? "Someone")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      paid {formatCents(balance.paid_cents)} · share{" "}
                      {formatCents(balance.owed_cents)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {balance.net_cents === 0 ? (
                      <span className="text-sm text-muted-foreground">settled</span>
                    ) : (
                      <>
                        <span className="block text-xs text-muted-foreground">
                          {balance.net_cents > 0 ? "is owed" : "owes"}
                        </span>
                        <MoneyAmount cents={balance.net_cents} />
                      </>
                    )}
                  </div>
                </li>
              );
            })}
        </ul>
      </section>

      {settlements.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Payments
          </h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {settlements.map((settlement) => (
              <li key={settlement.id} className="flex items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <span className="font-medium">
                      {nameOf(settlement.from_user, true)}
                    </span>{" "}
                    paid{" "}
                    <span className="font-medium">{nameOf(settlement.to_user)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateOnly(settlement.settled_at)}
                    {settlement.note ? ` · ${settlement.note}` : ""}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatCents(settlement.amount_cents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SettleUpDialog
        key={dialogKey}
        roomId={roomId}
        meId={meId}
        members={members}
        prefill={prefill}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={refresh}
      />
    </>
  );
}

function TransferRow({
  transfer,
  meId,
  memberById,
  nameOf,
  onSettle,
}: {
  transfer: Transfer;
  meId: string;
  memberById: Map<string, Member>;
  nameOf: (id: string, capitalized?: boolean) => string;
  onSettle: () => void;
}) {
  const other = transfer.from === meId ? transfer.to : transfer.from;
  const otherMember = memberById.get(other);
  const iOwe = transfer.from === meId;
  const involvesMe = transfer.from === meId || transfer.to === meId;

  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <MemberAvatar
        userId={other}
        displayName={otherMember?.display_name ?? "Someone"}
        avatarUrl={otherMember?.avatar_url}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          <span className="font-medium">{nameOf(transfer.from, true)}</span>
          {transfer.from === meId ? " owe " : " owes "}
          <span className="font-medium">{nameOf(transfer.to)}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {involvesMe
            ? iOwe
              ? "Tap settle up once you've paid them"
              : "Mark it settled when they pay you"
            : "Between the two of them"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <MoneyAmount
          cents={involvesMe && iOwe ? -transfer.amountCents : transfer.amountCents}
          neutral={!involvesMe}
        />
        <Button variant="ghost" size="sm" onClick={onSettle}>
          Settle
        </Button>
      </div>
    </div>
  );
}
