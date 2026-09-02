import Link from "next/link";
import { MemberAvatar } from "@/components/member-avatar";
import { SignOutMenuItem } from "@/components/sign-out-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Profile } from "@/lib/types/database";

export function AppHeader({
  user,
  children,
}: {
  user: Profile;
  children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
        <Link href="/" className="font-semibold tracking-tight">
          Roomsplit
        </Link>
        <div className="min-w-0 flex-1">{children}</div>
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <MemberAvatar
              userId={user.id}
              displayName={user.display_name}
              avatarUrl={user.avatar_url}
              className="size-8"
            />
            <span className="sr-only">Account menu</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="block font-medium">{user.display_name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <SignOutMenuItem />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
