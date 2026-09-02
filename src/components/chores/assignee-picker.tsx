"use client";

import { MemberAvatar } from "@/components/member-avatar";
import { firstName } from "@/lib/format";
import { cn } from "@/lib/utils";

type Member = { id: string; display_name: string; avatar_url: string | null };

/**
 * Avatar chips rather than a dropdown: with three or four roommates every
 * option fits on screen, and one tap beats open-scroll-tap on a phone.
 */
export function AssigneePicker({
  members,
  meId,
  value,
  onChange,
  size = "default",
}: {
  members: Member[];
  meId: string;
  value: string | null;
  onChange: (value: string | null) => void;
  size?: "default" | "sm";
}) {
  const compact = size === "sm";

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Assignee">
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        className={cn(
          "rounded-full border px-3 text-sm transition-colors",
          compact ? "h-7" : "h-8",
          value === null ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent",
        )}
      >
        Anyone
      </button>
      {members.map((member) => (
        <button
          key={member.id}
          type="button"
          onClick={() => onChange(member.id)}
          aria-pressed={value === member.id}
          className={cn(
            "flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 text-sm transition-colors",
            compact ? "h-7" : "h-8",
            value === member.id
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
      ))}
    </div>
  );
}
