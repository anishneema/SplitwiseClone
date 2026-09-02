/** Date and name helpers shared across the tabs. */

const DAY = 24 * 60 * 60 * 1000;

/** Parse a Postgres `date` ("2026-08-30") as a local date, not UTC midnight. */
export function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayDateOnly(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "Today", "Yesterday", "Aug 30" or "Aug 30, 2025" for other years. */
export function formatDateOnly(value: string): string {
  const date = parseDateOnly(value);
  const days = daysFromToday(value);
  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";
  if (days === 1) return "Tomorrow";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Negative = in the past. Whole days, ignoring time of day. */
export function daysFromToday(value: string): number {
  const target = parseDateOnly(value);
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - midnight.getTime()) / DAY);
}

/** "Due in 3 days" / "2 days overdue". */
export function describeDueDate(value: string): { label: string; overdue: boolean } {
  const days = daysFromToday(value);
  if (days === 0) return { label: "Due today", overdue: false };
  if (days === 1) return { label: "Due tomorrow", overdue: false };
  if (days === -1) return { label: "1 day overdue", overdue: true };
  if (days < -1) return { label: `${-days} days overdue`, overdue: true };
  if (days <= 7) return { label: `Due in ${days} days`, overdue: false };
  return { label: `Due ${formatDateOnly(value)}`, overdue: false };
}

/** "Anish" from "Anish Neema" — enough to identify a roommate. */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName;
}

/** Initials for the avatar fallback. */
export function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "you" / "Nav" so sentences read naturally. */
export function nameFor(
  userId: string,
  meId: string,
  names: Map<string, string>,
  capitalize = false,
): string {
  if (userId === meId) return capitalize ? "You" : "you";
  return firstName(names.get(userId) ?? "Someone");
}
