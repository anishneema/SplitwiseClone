import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/money";

/**
 * Renders an amount with the sign carried by color and wording rather than a
 * bare minus sign, which is easy to misread on a phone.
 *
 * Colour alone never carries the meaning — the accompanying label always says
 * "you are owed" or "you owe" — so this stays readable without color vision.
 */
export function MoneyAmount({
  cents,
  className,
  neutral = false,
}: {
  cents: number;
  className?: string;
  neutral?: boolean;
}) {
  const tone = neutral || cents === 0
    ? "text-foreground"
    : cents > 0
      ? "text-money-positive"
      : "text-money-negative";

  return (
    <span className={cn("font-semibold tabular-nums", tone, className)}>
      {formatCents(Math.abs(cents))}
    </span>
  );
}
