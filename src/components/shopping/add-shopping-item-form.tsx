"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AssigneePicker } from "@/components/assignee-picker";
import { MemberMultiPicker } from "@/components/member-multi-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type Member = { id: string; display_name: string; avatar_url: string | null };

/**
 * Same shape as AddChoreForm: type a name, hit Enter. The extras are optional
 * because most of the time "oat milk" is the whole request.
 *
 * "Who it's for" is asked here rather than at the till on purpose: you know who
 * needs the razors when you add them, and deciding it now means buying the
 * thing later is just a price. It defaults to you, and stays on your last
 * choice between adds so a shared shop isn't a tap per line.
 */
export function AddShoppingItemForm({
  roomId,
  meId,
  members,
  onAdded,
}: {
  roomId: string;
  meId: string;
  members: Member[];
  onAdded?: () => void;
}) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [forUsers, setForUsers] = useState<string[]>([meId]);
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0 || saving) return;

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("shopping_items").insert({
      room_id: roomId,
      name: trimmed,
      quantity: quantity.trim() || null,
      for_users: forUsers,
      assigned_to: assignedTo,
      requested_by: meId,
    });
    setSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    // Keep who it's for and who's buying — you're usually adding several things
    // for the same people — but clear the quantity, which belongs to one item.
    setName("");
    setQuantity("");
    onAdded?.();
  }

  return (
    <form onSubmit={submit} className="rounded-xl border bg-card p-3">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={() => setExpanded(true)}
          placeholder="Add something you need…"
          maxLength={140}
          aria-label="Item name"
        />
        <Button type="submit" disabled={saving || name.trim().length === 0}>
          Add
        </Button>
      </div>

      {expanded ? (
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="item-quantity" className="text-xs text-muted-foreground">
              How much
            </Label>
            <Input
              id="item-quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="2 boxes"
              maxLength={60}
              className="h-9 w-32"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Who it&apos;s for</Label>
            <MemberMultiPicker
              members={members}
              meId={meId}
              value={forUsers}
              onChange={setForUsers}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Who&apos;s buying</Label>
            <AssigneePicker
              members={members}
              meId={meId}
              value={assignedTo}
              onChange={setAssignedTo}
            />
          </div>
        </div>
      ) : null}
    </form>
  );
}
