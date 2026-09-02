"use client";

import { useEffect, useRef, useState } from "react";
import { MemberAvatar } from "@/components/member-avatar";
import { AssigneePicker } from "@/components/chores/assignee-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { describeDueDate, firstName, formatDateOnly } from "@/lib/format";
import type { Chore } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type Member = { id: string; display_name: string; avatar_url: string | null };

export function ChoreRow({
  chore,
  meId,
  members,
  assignee,
  onToggle,
  onUpdate,
  onDelete,
}: {
  chore: Chore;
  meId: string;
  members: Member[];
  assignee?: Member;
  onToggle: (done: boolean) => void;
  onUpdate: (patch: Partial<Chore>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(chore.title);
  const [draftDue, setDraftDue] = useState(chore.due_date ?? "");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) titleRef.current?.focus();
  }, [editing]);

  function openEditor() {
    setDraftTitle(chore.title);
    setDraftDue(chore.due_date ?? "");
    setEditing(true);
  }

  function commit() {
    const title = draftTitle.trim();
    const patch: Partial<Chore> = {};
    if (title.length > 0 && title !== chore.title) patch.title = title;
    if ((draftDue || null) !== chore.due_date) patch.due_date = draftDue || null;
    if (Object.keys(patch).length > 0) onUpdate(patch);
    setEditing(false);
  }

  const due = chore.due_date && !chore.done ? describeDueDate(chore.due_date) : null;
  const mine = chore.assigned_to === meId;

  if (editing) {
    return (
      <div className="space-y-3 bg-accent/30 p-3">
        <Input
          ref={titleRef}
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          maxLength={140}
          aria-label="Chore title"
        />
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <span className="block text-xs text-muted-foreground">Assign to</span>
            <AssigneePicker
              members={members}
              meId={meId}
              value={chore.assigned_to}
              onChange={(assigned_to) => onUpdate({ assigned_to })}
              size="sm"
            />
          </div>
          <div className="space-y-1.5">
            <span className="block text-xs text-muted-foreground">Due</span>
            <Input
              type="date"
              value={draftDue}
              onChange={(e) => setDraftDue(e.target.value)}
              className="h-8 w-40"
            />
          </div>
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

  return (
    <div className="flex items-center gap-3 px-3 py-3">
      {/* Generous hit area: this is the one control people tap in a hurry. */}
      <label className="flex cursor-pointer items-center py-1 pl-1 pr-1">
        <Checkbox
          checked={chore.done}
          onCheckedChange={(checked) => onToggle(checked)}
          aria-label={`Mark "${chore.title}" as ${chore.done ? "not done" : "done"}`}
        />
      </label>

      <button
        type="button"
        onClick={openEditor}
        className="min-w-0 flex-1 text-left"
      >
        <span
          className={cn(
            "block truncate",
            chore.done && "text-muted-foreground line-through",
          )}
        >
          {chore.title}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {chore.done ? (
            <>Done{chore.done_at ? ` ${formatDateOnly(chore.done_at.slice(0, 10))}` : ""}</>
          ) : (
            <>
              {due ? (
                <span className={cn(due.overdue && "font-medium text-money-negative")}>
                  {due.label}
                </span>
              ) : (
                <span>No due date</span>
              )}
            </>
          )}
        </span>
      </button>

      {assignee ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <MemberAvatar
            userId={assignee.id}
            displayName={assignee.display_name}
            avatarUrl={assignee.avatar_url}
            className="size-7"
          />
          <span
            className={cn(
              "hidden text-xs sm:inline",
              mine ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {mine ? "You" : firstName(assignee.display_name)}
          </span>
        </span>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">Unassigned</span>
      )}
    </div>
  );
}
