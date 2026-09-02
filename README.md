# Roomsplit

Shared expenses and a live chore list for a shared house. Splitwise's expense
splitting, plus the chore board Splitwise doesn't have.

- **Rooms and trips** — an ongoing place, or a one-off with a different group
- **Expenses** — split equally, by exact amounts, by percentage, or not at all
- **Balances** — net position per person, reduced to the fewest payments that
  clear everyone, plus "settle up" to record real-world payments
- **Chores** — assignee, due date, done/not-done, updating live across devices
- **Shopping list** — things you need someone else to pick up. You say who each
  item is for when you ask for it, so once it's bought, typing the prices turns
  the whole trip into one charge, split the way each line was requested. Your
  own share of what you bought isn't charged to you — it cancels against what
  you paid
- **Google sign-in**, invite links, and an optional per-room email allowlist

Setup instructions are in [SETUP.md](./SETUP.md).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui on Base UI ·
Supabase (Postgres, row-level security, Realtime, Auth) · deployed on Vercel.

## How it fits together

```
src/
  app/                      routes; each page loads its own data server-side
  components/               one folder per tab, plus shared bits
  lib/
    money.ts                integer-cent maths and splitting
    balances.ts             debt simplification
    queries.ts              queries shared by server render and client refetch
    dal.ts                  auth + room membership checks
    hooks/use-room-realtime.ts
    actions/rooms.ts        server actions for room-level mutations
supabase/migrations/        the schema, RLS policies and RPCs, in order
supabase/_localtest/        local verification scripts (not shipped)
```

Four conventions worth knowing before changing anything:

**Money is integer cents, everywhere.** `amount_cents`, `owed_cents`. Dollars
exist only as display strings and raw form input. A float dollar amount cannot
represent a three-way split of $10 without drifting.

**Every expense resolves to explicit `expense_splits` rows that sum to the
total.** The split mode is a UI concept; the database only stores the outcome.
Writes go through the `create_expense` / `update_expense` RPCs, which reject
splits that don't add up, so the invariant can't be broken from a browser.

**Authorization lives in the database.** Every table has row-level security
keyed on room membership. The checks in `lib/dal.ts` exist to produce a tidy
404 rather than an empty page — they are not the security boundary. Note that
auth checks belong in pages, not layouts: a layout doesn't re-render on
client-side navigation and doesn't gate whether its children render.

**Within a room, a record belongs to whoever entered it.** Membership decides
what you can *see*; authorship decides what you can *change*. A charge is
editable and deletable only by the person who added it (`created_by`), and a
shopping item only by the person who asked for it (`requested_by`) — with the
deliberate exception of the collaborative actions, claiming an item and ticking
it off, which anyone in the room may do. The UI mirrors this by opening
read-only rather than offering a control the write would refuse.

**A shopping item's price and its charge are the database's to write.**
`price_cents` and `expense_id` sit outside the column grants, so only
`charge_shopping_items()` can set them. That is what makes charging idempotent:
the queue is `bought and expense_id is null`, and no browser can unlink an item
to bill it twice. Deleting the expense sets `expense_id` back to null and
returns its items to the queue.

## Commands

| | |
|---|---|
| `npm run dev` | dev server |
| `npm run check` | typecheck, lint, unit tests |
| `npm run test:sql` | schema, RLS and RPC checks in a throwaway Postgres |
| `npm run test:db` | end-to-end checks against the local Supabase stack, incl. realtime |
| `npm run db:start` / `db:stop` | local Supabase in Docker |
| `npm run db:fresh` | reset + seed + a signed-in session per roommate |
| `npm run db:reset` | reapply migrations to the local database |
| `npm run db:seed` | seed a sample room |
| `npm run ui:open` | open the seeded app in signed-in browser windows |
| `npm run test:ui` | browser checks against a running dev server |
| `npm run test:local` | everything that doesn't need a browser |
| `npm run db:types` | regenerate `src/lib/types/database.ts` from the local schema |

## Not built yet

Recurring chores and rotation, multi-currency, expense comments, an activity
feed, push notifications, CSV export.

Prices are typed in by hand. The remaining half of that idea is photographing
the receipt and reading the lines off it — the price sheet is already the right
shape for it, since it takes a list of items and amounts and the beneficiaries
are settled before anyone reaches the till.
