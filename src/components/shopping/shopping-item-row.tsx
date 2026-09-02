"use client";

import { useEffect, useRef, useState } from "react";
import { MemberAvatar } from "@/components/member-avatar";
import { AssigneePicker } from "@/components/assignee-picker";
import { MemberMultiPicker, describeFor } from "@/components/member-multi-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { firstName } from "@/lib/format";
import { formatCents } from "@/lib/money";
import type { ShoppingItem, ShoppingItemPatch } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type Member = { id: string; display_name: string; avatar_url: string | null };

/**
 * Two rows in one. If you asked for the item you get an editor; if someone else
 * did, the item itself is read-only and the only things you can do are pick it
 * up and tick it off. That mirrors what the database allows, so the UI never
 * offers a control the write would reject.
 *
 * Once an item is on a charge it freezes: its price and beneficiaries are baked
 * into that expense's splits, so the checkbox and the "who it's for" picker go
 * dead until the charge is deleted.
 */
export function ShoppingItemRow({
  item,
  meId,
  members,
  nameById,
  assignee,
  buyer,
  onToggleBought,
  onUpdate,
  onDelete,
}: {
  item: ShoppingItem;
  meId: string;
  members: Member[];
  nameById: Map<string, string>;
  assignee?: Member;
  buyer?: Member;
  onToggleBought: (bought: boolean) => void;
  onUpdate: (patch: ShoppingItemPatch) => void;
  onDelete: () => void;
}) {
  const mine = item.requested_by === meId;
  const charged = item.expense_id !== null;
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(item.name);
  const [draftQuantity, setDraftQuantity] = useState(item.quantity ?? "");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) nameRef.current?.focus();
  }, [editing]);

  function openEditor() {
    setDraftName(item.name);
    setDraftQuantity(item.quantity ?? "");
    setEditing(true);
  }

  function commit() {
    const name = draftName.trim();
    const quantity = draftQuantity.trim() || null;
    const patch: ShoppingItemPatch = {};
    if (name.length > 0 && name !== item.name) patch.name = name;
    if (quantity !== item.quantity) patch.quantity = quantity;
    if (Object.keys(patch).length > 0) onUpdate(patch);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="space-y-3 bg-accent/30 p-3">
        <div className="flex gap-2">
          <Input
            ref={nameRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            maxLength={140}
            aria-label="Item name"
          />
          <Input
            value={draftQuantity}
            onChange={(e) => setDraftQuantity(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="2 boxes"
            maxLength={60}
            className="w-28 shrink-0"
            aria-label="How much"
          />
        </div>
        <div className="space-y-1.5">
          <span className="block text-xs text-muted-foreground">Who it&apos;s for</span>
          <MemberMultiPicker
            members={members}
            meId={meId}
            value={item.for_users}
            onChange={(for_users) => onUpdate({ for_users })}
            disabled={charged}
            size="sm"
          />
          {charged ? (
            <p className="text-xs text-muted-foreground">
              Already charged — delete that expense to change who pays.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <span className="block text-xs text-muted-foreground">Who&apos;s buying</span>
          <AssigneePicker
            members={members}
            meId={meId}
            value={item.assigned_to}
            onChange={(assigned_to) => onUpdate({ assigned_to })}
            size="sm"
          />
        </div>
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={commit}>
              Save
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const forLabel = describeFor(item.for_users, meId, nameById, members.length);
  const claimedByMe = item.assigned_to === meId;
  const buyerLabel = buyer ? (buyer.id === meId ? "you" : firstName(buyer.display_name)) : null;

  const status = charged
    ? "charged"
    : item.bought
      ? `bought${buyerLabel ? ` by ${buyerLabel}` : ""}`
      : assignee
        ? `${claimedByMe ? "you're" : `${firstName(assignee.display_name)} is`} getting it`
        : "nobody's got it yet";

  return (
    <div className="flex items-center gap-3 px-3 py-3">
      {/* Generous hit area: this is the control people tap in a shop aisle. */}
      <label
        className={cn(
          "flex items-center py-1 pl-1 pr-1",
          charged ? "cursor-default" : "cursor-pointer",
        )}
      >
        <Checkbox
          checked={item.bought}
          disabled={charged}
          onCheckedChange={(checked) => onToggleBought(checked)}
          aria-label={`Mark "${item.name}" as ${item.bought ? "not bought" : "bought"}`}
        />
      </label>

      <NameBlock
        editable={mine}
        onEdit={openEditor}
        name={item.name}
        quantity={item.quantity}
        detail={`${forLabel} · ${status}`}
        bought={item.bought}
      />

      {charged && item.price_cents !== null ? (
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {formatCents(item.price_cents)}
        </span>
      ) : item.bought ? null : claimedByMe || !assignee ? (
        <Button
          type="button"
          variant={claimedByMe ? "secondary" : "outline"}
          size="sm"
          onClick={() => onUpdate({ assigned_to: claimedByMe ? null : meId })}
          className="shrink-0"
        >
          {claimedByMe ? "Not me" : "I'll get it"}
        </Button>
      ) : (
        <MemberAvatar
          userId={assignee.id}
          displayName={assignee.display_name}
          avatarUrl={assignee.avatar_url}
          className="size-7 shrink-0"
        />
      )}
    </div>
  );
}

function NameBlock({
  editable,
  onEdit,
  name,
  quantity,
  detail,
  bought,
}: {
  editable: boolean;
  onEdit: () => void;
  name: string;
  quantity: string | null;
  detail: string;
  bought: boolean;
}) {
  const body = (
    <>
      <span className={cn("block truncate", bought && "text-muted-foreground line-through")}>
        {name}
        {quantity ? (
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            {quantity}
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span>
    </>
  );

  // Only the requester gets a button here — for everyone else there is nothing
  // behind the tap, and a control that does nothing is worse than no control.
  return editable ? (
    <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
      {body}
    </button>
  ) : (
    <div className="min-w-0 flex-1">{body}</div>
  );
}
