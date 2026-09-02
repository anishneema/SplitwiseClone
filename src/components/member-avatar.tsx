import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

// Stable per-person tint so roommates stay visually distinguishable across tabs
// even before their Google photo loads.
const TINTS = [
  "bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-100",
  "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  "bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-100",
  "bg-rose-100 text-rose-900 dark:bg-rose-900 dark:text-rose-100",
  "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
  "bg-lime-100 text-lime-900 dark:bg-lime-900 dark:text-lime-100",
];

function tintFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length];
}

export function MemberAvatar({
  userId,
  displayName,
  avatarUrl,
  className,
}: {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-9", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
      <AvatarFallback className={cn("text-xs font-semibold", tintFor(userId))}>
        {initials(displayName)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Overlapping avatars for a room roster. */
export function MemberAvatarStack({
  members,
  max = 4,
}: {
  members: Array<{ id: string; display_name: string; avatar_url: string | null }>;
  max?: number;
}) {
  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;

  return (
    <div className="flex items-center">
      {shown.map((m) => (
        <MemberAvatar
          key={m.id}
          userId={m.id}
          displayName={m.display_name}
          avatarUrl={m.avatar_url}
          className="size-7 -mr-2 ring-2 ring-background last:mr-0"
        />
      ))}
      {overflow > 0 ? (
        <span className="ml-3 text-xs text-muted-foreground">+{overflow}</span>
      ) : null}
    </div>
  );
}
