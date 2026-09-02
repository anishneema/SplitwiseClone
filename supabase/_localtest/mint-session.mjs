/**
 * Mints browser auth cookies for a local test user by letting @supabase/ssr
 * write them itself, so the names, chunking and encoding are whatever the app
 * actually expects rather than a guess.
 *
 * Used only by the local UI smoke test; Google OAuth is the real sign-in path.
 *   node supabase/_localtest/mint-session.mjs <email>
 */
import { createServerClient } from "@supabase/ssr";

const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
// Default to the standard local Supabase demo keys, which are identical on
// every `supabase start` install and are not secrets. Override via env to
// point these scripts at another stack.
const ANON = process.env.SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const email = process.argv[2];

if (!email) {
  console.error("usage: node mint-session.mjs <email>");
  process.exit(1);
}

const written = [];
const supabase = createServerClient(API, ANON, {
  cookies: {
    getAll: () => [],
    setAll: (cookies) => written.push(...cookies),
  },
});

const { error } = await supabase.auth.signInWithPassword({
  email,
  password: "test-password-123",
});
if (error) {
  console.error("sign-in failed:", error.message);
  process.exit(1);
}

console.log(
  JSON.stringify(
    written.map(({ name, value }) => ({
      name,
      value,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    })),
  ),
);
