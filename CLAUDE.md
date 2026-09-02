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
