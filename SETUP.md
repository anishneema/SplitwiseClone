# Setup

Two paths. **Local** needs no accounts and works offline. **Hosted** is what your
roommates will actually use, and is the only one that needs Google OAuth.

---

## Local development

Requires Docker Desktop running. Nothing in this section touches the hosted
project — it is a throwaway database full of fake roommates.

```bash
npm install
npm run db:start          # Postgres, Auth, Realtime, Studio in Docker
npm run db:fresh          # migrations + sample data + a session per roommate
npm run dev
```

`db:fresh` runs `db:reset` (reapply every file in `supabase/migrations/` to an
empty database), then `db:seed`, then `db:sessions`. It leaves you with:

| | |
|---|---|
| A room, "Apartment 4B" | three roommates: Anish, Nav, Sam |
| Two expenses | entered by **different** people, so you can see a charge you may edit next to one you may only read |
| Two chores | one overdue, one unassigned |
| A five-item shopping list | one for you, one for the house, one claimed, one already charged |
| Two unpriced trips | Anish and Nav have each bought something, so the "add prices" bar is there to try as either |
| `/tmp/seed.json` | the room id, invite code and user ids it created |
| `/tmp/cookies-{anish,nav,sam}.json` | signed-in browser cookies, one per roommate |

### Which database `npm run dev` talks to

`.env.development.local` holds the local stack's URL and anon key, and Next.js
resolves that file *ahead of* `.env.local` when running `next dev`. So
`npm run dev` is always pointed at Docker, while `.env.local` keeps the hosted
values for `next build` and Vercel. Nothing needs commenting in and out, and a
dev server cannot quietly end up writing to production.

Delete or rename `.env.development.local` if you deliberately want a dev server
against the hosted project.

### Signing in locally

Google sign-in does not work against the local stack — there is no OAuth client
pointed at it — so there is no way to log in by hand. `npm run ui:open` opens the
seeded room in real browser windows that are already signed in:

```bash
npm run dev        # in one terminal
npm run ui:open    # Anish and Nav, side by side
npm run ui:open anish nav sam
```

That uses the cookies `db:fresh` minted and Playwright's chromium, so install it
once with `npm i --no-save playwright && npx playwright install chromium`.
Two windows side by side is the point: write on one, watch it land on the other.

To mint a session for some other account:

```bash
node supabase/_localtest/mint-session.mjs anish.e2e@example.com
```

Supabase Studio is at http://127.0.0.1:54323 for poking at the data directly.
`npm run db:stop` shuts it all down.

---

## Hosted setup

### 1. Create the Supabase project

1. Go to https://supabase.com/dashboard and create a project (free tier is fine).
   Pick a region near you and save the database password somewhere.
2. Wait for it to finish provisioning (~2 minutes).

### 2. Apply the schema

1. In the dashboard, open **SQL Editor** → **New query**.
2. Paste the contents of each file in `supabase/migrations/`, **in filename
   order**, running them one at a time. They build on each other, so the order
   matters and a later one will fail on its own.
3. Each should finish with no errors.

Or, with the CLI, which applies them in order and records which have already
run — worth switching to now that there is more than one:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### 3. Create the Google OAuth client

1. Go to https://console.cloud.google.com/apis/credentials and create a project
   if you don't have one.
2. **Configure the consent screen** first (it will nag you otherwise):
   OAuth consent screen → External → fill in an app name and your email → Save.
   You can leave it in "Testing" mode; add your roommates' Gmail addresses under
   **Test users** so they can sign in.
3. **Credentials** → **Create credentials** → **OAuth client ID**.
   - Application type: **Web application**
   - Authorised redirect URI — this must be the *Supabase* callback, not your app:
     ```
     https://<your-project-ref>.supabase.co/auth/v1/callback
     ```
4. Copy the **Client ID** and **Client secret**.

### 4. Enable Google in Supabase

1. Supabase dashboard → **Authentication** → **Sign In / Providers** → **Google**.
2. Enable it, paste the client ID and secret, save.
3. **Authentication** → **URL Configuration**:
   - **Site URL**: your production URL (e.g. `https://roomsplit.vercel.app`)
   - **Redirect URLs**: add both
     ```
     http://localhost:3000/**
     https://<your-app>.vercel.app/**
     ```

> Getting `redirect_uri_mismatch` from Google almost always means step 3's URI
> has your app's domain in it instead of Supabase's.

### 5. Point the app at it

Supabase dashboard → **Project Settings** → **Data API** for the URL, and
**API Keys** for the anon (a.k.a. publishable) key.

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

The anon key is designed to be public — every security boundary in this app is
enforced by row-level security in Postgres, not by hiding that key.

### 6. Deploy to Vercel

```bash
npx vercel            # first run links the project
npx vercel --prod
```

Set the same three variables in Vercel → Settings → Environment Variables, with
`NEXT_PUBLIC_SITE_URL` set to the production URL so invite links point at the
right host. Then redeploy and go back to step 4.3 to add the real domain to
Supabase's redirect list.

---

## Verifying it works

```bash
npm run test:local     # all three of the below, in order
npm run check          # types, lint, 17 unit tests on the money/balance maths
npm run test:sql       # 62 schema/RLS/RPC checks in a throwaway Postgres
npm run test:db        # 106 checks through the real API, including realtime
```

`test:sql` applies every migration to a disposable container, so it also proves
the migrations apply cleanly in order before any of them reach production.

There are also browser checks that drive two signed-in sessions side by side and
assert that one screen updates when the other writes. Playwright isn't a project
dependency, so install it on demand:

```bash
npm i --no-save playwright && npx playwright install chromium
npm run db:fresh
npm run dev   # in another terminal
npm run test:ui
```

`test:ui` is `flows.mjs` (76 checks: navigation, realtime, chores, shopping
list, pricing a trip into a charge) then `splits.mjs` (29 checks: read-only
charges, edit, percentages, personal, delete). Screenshots land in `/tmp/shots`. Both scripts assume the dev
server is on `http://localhost:3000`; if that port is taken, pass
`BASE_URL=http://localhost:3001`. Re-run `npm run db:fresh` between runs — they
write to the database and expect the seeded figures.

By hand, with two browsers side by side in the same room:

- Add an expense in one; it should appear in the other within a second.
- Tick a chore in one; the checkbox should move in the other.
- Split $10 three ways and confirm the shares are $3.34 / $3.33 / $3.33.
- In Exact mode, confirm Save stays disabled until the shares hit the total.
- Sign in with an account that isn't a member and confirm the room 404s.
- Open a charge someone else entered: it should say who added it, show every
  figure, and offer no Save or Delete. Then open your own and edit it.
- Add a shopping item in one browser; in the other, tap "I'll get it" and tick
  it off. Both should move on the first screen without a reload.
- Add one item for yourself and one for "Everyone". Tick both off, hit **Add
  prices**, and check the preview: the shared one splits three ways with the odd
  penny going to the top of the list, and your own share is listed as *not*
  charged to you. Adding the charge should appear on the Expenses tab of the
  other browser.
- Buy something that is only for you and price it. It should log as "not split"
  and move nobody's balance — you spent your own money on yourself.
- Delete that charge from the Expenses tab. Its items should reappear waiting to
  be priced, with the prices you typed still there.

### Before pushing to production

```bash
npm run test:local     # types, lint, unit, schema/RLS, real-API end-to-end
npx supabase db push   # apply the new migrations to the hosted project
```

`db push` is additive here: the charge-authorship migration replaces a policy
and a function, and the shopping list migration only adds a table. Existing
expenses already carry `created_by`, so nothing needs backfilling.
