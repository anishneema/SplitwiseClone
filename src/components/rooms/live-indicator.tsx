import { cn } from "@/lib/utils";
import type { ChannelStatus } from "@/lib/hooks/use-room-realtime";

/**
 * Tiny connection dot. Worth showing: in a live-updating app, a stale screen
 * and a quiet screen look identical, and people trust numbers they can see are
 * current.
 */
export function LiveIndicator({ status }: { status: ChannelStatus }) {
  const copy: Record<ChannelStatus, string> = {
    connecting: "Connecting…",
    live: "Live",
    offline: "Offline — reload to catch up",
  };

  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title={copy[status]}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          status === "live" && "bg-money-positive",
          status === "connecting" && "animate-pulse bg-muted-foreground",
          status === "offline" && "bg-money-negative",
        )}
      />
      <span className="sr-only sm:not-sr-only">{copy[status]}</span>
    </span>
  );
}
