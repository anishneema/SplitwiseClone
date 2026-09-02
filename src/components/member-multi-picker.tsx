"use client";

import { MemberAvatar } from "@/components/member-avatar";
import { firstName } from "@/lib/format";
import { cn } from "@/lib/utils";

type Member = { id: string; display_name: string; avatar_url: string | null };

/**
 * Like AssigneePicker, but for "who is this for" — several people at once, and
 * never nobody. An item with no beneficiaries has nobody to charge, which the
 * database rejects, so the last selected chip refuses to switch itself off.
 */
export function MemberMultiPicker({
  members,
  meId,
  value,
  onChange,
  disabled = false,
  size = "default",
}: {
  members: Member[];
  meId: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  size?: "default" | "sm";
}) {
  const compact = size === "sm";
  const everyone = members.length > 1 && value.length === members.length;

  function toggle(id: string) {
    if (value.includes(id)) {
      // Refuse to empty the selection rather than letting a save fail later.
      if (value.length === 1) return;
      onChange(value.filter((x) => x !== id));
      return;
    }
    // Keep the room's own order so the penny remainder lands the same way the
    // server splits it.
    onChange(members.filter((m) => value.includes(m.id) || m.id === id).map((m) => m.id));
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label="Who it's for"
    >
      {members.map((member) => {
        const selected = value.includes(member.id);
        return (
          <button
            key={member.id}
            type="button"
            disabled={disabled}
            onClick={() => toggle(member.id)}
            aria-pressed={selected}
            className={cn(
              "flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 text-sm transition-colors disabled:opacity-50",
              compact ? "h-7" : "h-8",
              selected
                ? "border-primary bg-primary/10 font-medium"
                : "hover:bg-accent",
            )}
          >
            <MemberAvatar
              userId={member.id}
              displayName={member.display_name}
              avatarUrl={member.avatar_url}
              className={compact ? "size-5" : "size-6"}
            />
            {member.id === meId ? "Me" : firstName(member.display_name)}
          </button>
        );
      })}

      {members.length > 1 ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(everyone ? [meId] : members.map((m) => m.id))}
          aria-pressed={everyone}
          className={cn(
            "rounded-full border px-3 text-sm transition-colors disabled:opacity-50",
            compact ? "h-7" : "h-8",
            everyone ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent",
          )}
        >
          Everyone
        </button>
      ) : null}
    </div>
  );
}

/** "for you", "for you and Nav", "for everyone" — the phrase used on a row. */
export function describeFor(
  forUsers: string[],
  meId: string,
  nameById: Map<string, string>,
  memberCount: number,
): string {
  if (memberCount > 1 && forUsers.length === memberCount) return "for everyone";

  const names = forUsers.map((id) =>
    id === meId ? "you" : firstName(nameById.get(id) ?? "someone"),
  );
  if (names.length === 1) return `for ${names[0]}`;
  return `for ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
