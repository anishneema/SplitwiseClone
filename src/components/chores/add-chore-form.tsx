"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AssigneePicker } from "@/components/assignee-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type Member = { id: string; display_name: string; avatar_url: string | null };

/**
 * Always-visible single-line add box, Notion-style: the fast path is type a
 * title and hit Enter, with assignee and due date as optional extras.
 */
export function AddChoreForm({
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
  const [title, setTitle] = useState("");
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0 || saving) return;

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("chores").insert({
      room_id: roomId,
      title: trimmed,
      assigned_to: assignedTo,
      due_date: dueDate || null,
      created_by: meId,
    });
    setSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    // Keep the assignee and due date so adding several chores for the same
    // person in a row doesn't mean re-picking them every time.
    setTitle("");
    onAdded?.();
  }

  return (
    <form onSubmit={submit} className="rounded-xl border bg-card p-3">
      <div className="flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setExpanded(true)}
          placeholder="Add a chore…"
          maxLength={140}
          aria-label="Chore title"
        />
        <Button type="submit" disabled={saving || title.trim().length === 0}>
          Add
        </Button>
      </div>

      {expanded ? (
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Assign to</Label>
            <AssigneePicker
              members={members}
              meId={meId}
              value={assignedTo}
              onChange={setAssignedTo}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chore-due" className="text-xs text-muted-foreground">
              Due
            </Label>
            <Input
              id="chore-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-9 w-40"
            />
          </div>
        </div>
      ) : null}
    </form>
  );
}
