"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Plain links rather than a tabs widget: each tab is a real route, so the
 * browser back button and deep links behave the way people expect.
 */
export function RoomTabs({ roomId }: { roomId: string }) {
  const pathname = usePathname();
  const base = `/rooms/${roomId}`;

  const tabs = [
    { href: base, label: "Expenses" },
    { href: `${base}/balances`, label: "Balances" },
    { href: `${base}/chores`, label: "Chores" },
    { href: `${base}/shopping`, label: "Shopping" },
    { href: `${base}/settings`, label: "Settings" },
  ];

  return (
    <nav
      aria-label="Room sections"
      className="sticky top-14 z-20 border-b bg-background/85 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-3xl gap-1 overflow-x-auto px-2">
        {tabs.map((tab) => {
          const active =
            tab.href === base ? pathname === base : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative shrink-0 px-3 py-3 text-sm font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {active ? (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
