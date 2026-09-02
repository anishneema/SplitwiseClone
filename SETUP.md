# Setup

Two paths. **Local** needs no accounts and works offline. **Hosted** is what your
roommates will actually use, and is the only one that needs Google OAuth.

---

## Local development

Requires Docker Desktop running.

```bash
npm install
npm run db:start          # starts Postgres, Auth, Realtime, Studio in Docker
npm run db:reset          # applies supabase/migrations/
npm run db:seed           # optional: three roommates, a few expenses, two chores
npm run dev
```

`npm run db:start` prints an API URL and keys. Put them in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the ANON_KEY it printed>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Google sign-in does not work against the local stack — there's no OAuth client
pointed at it. For local UI work, mint a session cookie for a seeded user:

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
2. Paste the entire contents of `supabase/migrations/20260830000000_init.sql`.
3. Run it. It should finish with no errors.

Or, with the CLI, keeping migrations versioned (recommended once the schema
settles):

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
npm run check          # types, lint, 17 unit tests on the money/balance maths
npm run test:sql       # 20 schema/RLS/RPC checks in a throwaway Postgres
npm run test:db        # 53 checks through the real API, including realtime
```

There are also browser checks that drive two signed-in sessions side by side and
assert that one screen updates when the other writes. Playwright isn't a project
dependency, so install it on demand:

```bash
npm i --no-save playwright && npx playwright install chromium
npm run db:reset && npm run db:seed > /tmp/seed.json
node supabase/_localtest/mint-session.mjs anish.e2e@example.com > /tmp/cookies-anish.json
node supabase/_localtest/mint-session.mjs nav.e2e@example.com   > /tmp/cookies-nav.json
npm run dev   # in another terminal
node supabase/_localtest/ui/flows.mjs    # 41 checks: navigation, realtime, chores
node supabase/_localtest/ui/splits.mjs   # 24 checks: edit, percentages, personal, delete
```

By hand, with two browsers side by side in the same room:

- Add an expense in one; it should appear in the other within a second.
- Tick a chore in one; the checkbox should move in the other.
- Split $10 three ways and confirm the shares are $3.34 / $3.33 / $3.33.
- In Exact mode, confirm Save stays disabled until the shares hit the total.
- Sign in with an account that isn't a member and confirm the room 404s.
