import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * Sign-out is a POST form rather than a link so it cannot be triggered by a
 * prefetch or an <img> tag on another site.
 *
 * `render` is Base UI's equivalent of Radix's `asChild` — this shadcn build sits
 * on Base UI.
 */
export function SignOutMenuItem() {
  return (
    <form action="/auth/signout" method="post">
      <DropdownMenuItem
        render={<button type="submit" />}
        className="w-full cursor-pointer text-left"
      >
        Sign out
      </DropdownMenuItem>
    </form>
  );
}
