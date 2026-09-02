"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { AddChoreForm } from "@/components/chores/add-chore-form";
import { ChoreRow } from "@/components/chores/chore-row";
import { LiveIndicator } from "@/components/rooms/live-indicator";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { useRoomRealtime } from "@/lib/hooks/use-room-realtime";
import { fetchChores } from "@/lib/queries";
import { daysFromToday } from "@/lib/format";
import type { Chore } from "@/lib/types/database";
import { cn } from "@/lib/utils";

type Member = { id: string; display_name: string; avatar_url: string | null };
type Filter = "open" | "mine" | "done";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "open", label: "To do" },
  { value: "mine", label: "Mine" },
  { value: "done", label: "Done" },
];

export function ChoresTab({
  roomId,
  meId,
  members,
  initialChores,
}: {
  roomId: string;
  meId: string;
  members: Member[];
  initialChores: Chore[];
}) {
  const [chores, setChores] = useState(initialChores);
  const [filter, setFilter] = useState<Filter>("open");

  const refresh = useCallback(async () => {
    const supabase = createClient();
    setChores(await fetchChores(supabase, roomId));
  }, [roomId]);

  const status = useRoomRealtime(roomId, ["chores"], refresh);

  /**
   * Toggling is applied locally before the write lands, because a checkbox that
   * waits on a round-trip feels broken. The Realtime echo replaces the same row
   * by id, so the optimistic value and the authoritative one converge; on error
   * we put the old row back.
   */
  const toggleDone = useCallback(
    async (chore: Chore, done: boolean) => {
      setChores((current) =>
        current.map((c) => (c.id === chore.id ? { ...c, done } : c)),
      );

      const supabase = createClient();
      const { error } = await supabase
        .from("chores")
        .update({ done })
        .eq("id", chore.id);

      if (error) {
        setChores((current) =>
          current.map((c) => (c.id === chore.id ? { ...c, done: chore.done } : c)),
        );
        toast.error(error.message);
      }
    },
    [],
  );

  const updateChore = useCallback(
    async (chore: Chore, patch: Partial<Chore>) => {
      setChores((current) =>
        current.map((c) => (c.id === chore.id ? { ...c, ...patch } : c)),
      );

      const supabase = createClient();
      const { error } = await supabase.from("chores").update(patch).eq("id", chore.id);

      if (error) {
        setChores((current) => current.map((c) => (c.id === chore.id ? chore : c)));
        toast.error(error.message);
      }
    },
    [],
  );

  const deleteChore = useCallback(
    async (chore: Chore) => {
      setChores((current) => current.filter((c) => c.id !== chore.id));

      const supabase = createClient();
      const { error } = await supabase.from("chores").delete().eq("id", chore.id);

      if (error) {
        await refresh();
        toast.error(error.message);
      }
    },
    [refresh],
  );

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const visible = useMemo(() => {
    const list = chores.filter((chore) => {
      if (filter === "done") return chore.done;
      if (filter === "mine") return !chore.done && chore.assigned_to === meId;
      return !chore.done;
    });

    // Overdue first, then soonest due, then undated, then newest.
    return list.sort((a, b) => {
      if (a.due_date && b.due_date) {
        return daysFromToday(a.due_date) - daysFromToday(b.due_date);
      }
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [chores, filter, meId]);

  const openCount = chores.filter((c) => !c.done).length;
  const mineCount = chores.filter((c) => !c.done && c.assigned_to === meId).length;
  const counts: Record<Filter, number> = {
    open: openCount,
    mine: mineCount,
    done: chores.filter((c) => c.done).length,
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Chores</h1>
          <p className="text-sm text-muted-foreground">
            {openCount === 0
              ? "Nothing outstanding."
              : `${openCount} to do${mineCount > 0 ? ` · ${mineCount} assigned to you` : ""}`}
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

      <AddChoreForm roomId={roomId} meId={meId} members={members} onAdded={refresh} />

      {visible.length === 0 ? (
        <Card className="mt-4">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {filter === "done"
              ? "Nothing finished yet."
              : filter === "mine"
                ? "Nothing assigned to you. Enjoy it."
                : "No chores yet — add the first one above."}
          </CardContent>
        </Card>
      ) : (
        <ul className="mt-4 divide-y overflow-hidden rounded-xl border bg-card">
          {visible.map((chore) => (
            <li key={chore.id}>
              <ChoreRow
                chore={chore}
                meId={meId}
                members={members}
                assignee={chore.assigned_to ? memberById.get(chore.assigned_to) : undefined}
                onToggle={(done) => toggleDone(chore, done)}
                onUpdate={(patch) => updateChore(chore, patch)}
                onDelete={() => deleteChore(chore)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
