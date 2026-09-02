@AGENTS.md

# Roomsplit

Shared expenses + chores for roommates. See README.md for architecture and
SETUP.md for Supabase/Google OAuth setup.

Non-obvious constraints:

- **Money is integer cents everywhere** (`amount_cents`, `owed_cents`). Never
  introduce float dollars.
- **Expenses are written only through the `create_expense`/`update_expense`
  RPCs**, which validate that `expense_splits` sum exactly to the total. There
  is deliberately no insert/update RLS policy on `expense_splits`.
- **RLS is the security boundary**, not `lib/dal.ts`. Membership helpers in SQL
  are `SECURITY DEFINER` to avoid infinite recursion in `room_members` policies.
- **Membership decides what you can see; authorship decides what you can
  change.** Expenses are editable/deletable only by `created_by` (enforced in
  the `expenses_delete` policy *and* inside `update_expense`, because a
  `SECURITY DEFINER` function bypasses RLS). Shopping items likewise belong to
  `requested_by` — except `bought` and claiming, which any member may change.
  Column-level authority like that cannot come from a policy, so it lives in the
  `shopping_items_before_update` trigger.
- **Who a shopping item is for is decided when it's requested** (`for_users`,
  one or more people), not when it's paid for — so by the time it's bought the
  split is already settled. `charge_shopping_items` divides each line between
  its `for_users` in integer cents with the remainder going to the leading
  entries, which is deliberately the same rule as `splitEqual` in
  `lib/money.ts`; the browser preview and the stored splits have to agree to the
  penny. Summing those per person is exact, so `create_expense`'s
  splits-equal-total check can never fail on a shopping charge.
- **Your own share of a shopping charge is not a debt.** The expense records
  the full amount you paid and splits it across `for_users`, so your own share
  cancels against what you paid and only the others' shares move. Say that
  plainly in any UI that previews a charge — listing yourself alongside the
  people who owe you reads as being billed for your own shopping. A trip whose
  splits collapse to just the payer is recorded as `personal`, not a one-way
  `exact` split.
- **`price_cents` and `expense_id` are outside the column grants** on
  `shopping_items`, so only `charge_shopping_items` can write them. That is what
  makes charging idempotent — the queue is `bought and expense_id is null`, and
  no client can unlink an item to bill it twice. `ShoppingItemPatch` in
  `types/database.ts` mirrors the grant, so a forbidden write fails to compile.
- **A new migration must grant its own privileges.** The blanket
  `grant ... on all tables ... to authenticated` in the init migration applied
  only to the tables that existed then, and Supabase's default privileges hand
  new public tables to `anon`. Every new table needs an explicit
  `revoke all ... from anon` plus a `grant` to `authenticated` — and, for
  Realtime, `replica identity full` and an `alter publication` line.
- **Auth checks go in pages, not layouts** — a layout doesn't re-render on
  client-side navigation and doesn't gate its children.
- **`useRoomRealtime` must load the session and set Realtime auth before
  subscribing.** Subscribing first makes Realtime evaluate the subscription as
  `anon`, which this schema grants nothing; the channel still reports
  SUBSCRIBED and then silently delivers nothing.
- Dates are stored as `date` and always sent from the client as a local
  calendar date. The columns default to `current_date`, which is the database's
  UTC date — don't rely on it.
- This shadcn build sits on **Base UI**, not Radix: use `render={<X />}` where
  you'd reach for `asChild`.
- **`.env.development.local` points `next dev` at the local Docker stack** and
  takes precedence over `.env.local`, which holds the hosted project. Don't
  "fix" a local dev server reading local data by editing `.env.local`.
- **`npm run test:sql` applies every migration** to a throwaway container, so
  new migration files are picked up automatically — but new assertion suites
  must be added to the `SUITES` list in `run-sql-checks.sh`.
