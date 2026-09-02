"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { AddShoppingItemForm } from "@/components/shopping/add-shopping-item-form";
import { ChargePurchasesDialog } from "@/components/shopping/charge-purchases-dialog";
import { ShoppingItemRow } from "@/components/shopping/shopping-item-row";
import { LiveIndicator } from "@/components/rooms/live-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { useRoomRealtime } from "@/lib/hooks/use-room-realtime";
import { fetchShoppingItems } from "@/lib/queries";
import type { ShoppingItem, ShoppingItemPatch } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type Member = { id: string; display_name: string; avatar_url: string | null };
type Filter = "open" | "mine" | "bought";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "open", label: "To buy" },
  { value: "mine", label: "On me" },
  { value: "bought", label: "Bought" },
];

export function ShoppingTab({
  roomId,
  meId,
  members,
  initialItems,
}: {
  roomId: string;
  meId: string;
  members: Member[];
  initialItems: ShoppingItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<Filter>("open");
  const [chargeOpen, setChargeOpen] = useState(false);
  // Bumped on every open so the dialog remounts with fresh prices.
  const [chargeKey, setChargeKey] = useState(0);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    setItems(await fetchShoppingItems(supabase, roomId));
  }, [roomId]);

  const status = useRoomRealtime(roomId, ["shopping_items"], refresh);

  /**
   * Applied locally before the write lands — the same reasoning as the chore
   * checkbox. The Realtime echo replaces the row by id, so the optimistic value
   * and the authoritative one converge; on error we put the old row back and
   * show what the database said, since some of these writes are refused on
   * purpose (only the requester may change what an item is).
   */
  const patchItem = useCallback(
    async (item: ShoppingItem, patch: ShoppingItemPatch) => {
      setItems((current) => current.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));

      const supabase = createClient();
      const { error } = await supabase
        .from("shopping_items")
        .update(patch)
        .eq("id", item.id);

      if (error) {
        setItems((current) => current.map((i) => (i.id === item.id ? item : i)));
        toast.error(error.message);
      }
    },
    [],
  );

  const deleteItem = useCallback(
    async (item: ShoppingItem) => {
      setItems((current) => current.filter((i) => i.id !== item.id));

      const supabase = createClient();
      const { error } = await supabase.from("shopping_items").delete().eq("id", item.id);

      if (error) {
        await refresh();
        toast.error(error.message);
      }
    },
    [refresh],
  );

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const nameById = useMemo(
    () => new Map(members.map((m) => [m.id, m.display_name])),
    [members],
  );

  /**
   * What you bought and haven't billed anyone for yet. Only your own purchases:
   * the charge is recorded as paid by you, and the RPC refuses lines you didn't
   * tick off yourself.
   */
  const toCharge = useMemo(
    () => items.filter((i) => i.bought && !i.expense_id && i.bought_by === meId),
    [items, meId],
  );

  const visible = useMemo(() => {
    const list = items.filter((item) => {
      if (filter === "bought") return item.bought;
      // "On me" is what other people are waiting on you for, which is the
      // question you actually have on the way home.
      if (filter === "mine") return !item.bought && item.assigned_to === meId;
      return !item.bought;
    });

    // Claimed first (someone's acting on them), then newest.
    return list.sort((a, b) => {
      if (Boolean(a.assigned_to) !== Boolean(b.assigned_to)) return a.assigned_to ? -1 : 1;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [items, filter, meId]);

  const openCount = items.filter((i) => !i.bought).length;
  const mineCount = items.filter((i) => !i.bought && i.assigned_to === meId).length;
  const counts: Record<Filter, number> = {
    open: openCount,
    mine: mineCount,
    bought: items.filter((i) => i.bought).length,
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Shopping list</h1>
          <p className="text-sm text-muted-foreground">
            {openCount === 0
              ? "Nothing on the list."
              : `${openCount} to buy${mineCount > 0 ? ` · ${mineCount} on you` : ""}`}
          </p>
        </div>
        <LiveIndicator status={status} />
      </div>

      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            aria-pressed={filter === option.value}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              filter === option.value
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            <span className="ml-1.5 text-xs tabular-nums opacity-60">
              {counts[option.value]}
            </span>
          </button>
        ))}
      </div>

      {toCharge.length > 0 ? (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              You bought {toCharge.length} thing{toCharge.length === 1 ? "" : "s"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Add the prices to charge {toCharge.length === 1 ? "it" : "them"} to whoever
              {toCharge.length === 1 ? " it was" : " they were"} for.
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => {
              setChargeKey((n) => n + 1);
              setChargeOpen(true);
            }}
          >
            Add prices
          </Button>
        </div>
      ) : null}

      <AddShoppingItemForm
        roomId={roomId}
        meId={meId}
        members={members}
        onAdded={refresh}
      />

      {visible.length === 0 ? (
        <Card className="mt-4">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {filter === "bought"
              ? "Nothing bought yet."
              : filter === "mine"
                ? "Nobody's waiting on you. Enjoy it."
                : "Nothing on the list — add the first thing above."}
          </CardContent>
        </Card>
      ) : (
        <ul className="mt-4 divide-y overflow-hidden rounded-xl border bg-card">
          {visible.map((item) => (
            <li key={item.id}>
              <ShoppingItemRow
                item={item}
                meId={meId}
                members={members}
                nameById={nameById}
                assignee={item.assigned_to ? memberById.get(item.assigned_to) : undefined}
                buyer={item.bought_by ? memberById.get(item.bought_by) : undefined}
                onToggleBought={(bought) => patchItem(item, { bought })}
                onUpdate={(patch) => patchItem(item, patch)}
                onDelete={() => deleteItem(item)}
              />
            </li>
          ))}
        </ul>
      )}

      {toCharge.length > 0 ? (
        <ChargePurchasesDialog
          key={chargeKey}
          roomId={roomId}
          meId={meId}
          members={members}
          nameById={nameById}
          items={toCharge}
          open={chargeOpen}
          onOpenChange={setChargeOpen}
          onSaved={refresh}
        />
      ) : null}
    </>
  );
}
