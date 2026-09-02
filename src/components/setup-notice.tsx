import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shown instead of a crash when .env.local has no Supabase credentials, so
 * `npm run dev` is useful on a fresh clone.
 */
export function SetupNotice() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 items-center px-4 py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl">Finish connecting Supabase</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          <p className="text-muted-foreground">
            The app is running, but it has no database to talk to yet. Three steps:
          </p>
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              Create a free project at{" "}
              <a
                className="font-medium text-primary underline underline-offset-4"
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noreferrer"
              >
                supabase.com/dashboard
              </a>
              .
            </li>
            <li>
              Open the SQL editor and run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                supabase/migrations/20260830000000_init.sql
              </code>{" "}
              from this repo.
            </li>
            <li>
              Copy the project URL and anon key into{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                .env.local
              </code>
              , then restart the dev server:
              <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
{`NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...`}
              </pre>
            </li>
          </ol>
          <p className="text-muted-foreground">
            Google sign-in also needs enabling under Authentication → Providers.
            The full walkthrough is in <code className="font-mono text-xs">SETUP.md</code>.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
