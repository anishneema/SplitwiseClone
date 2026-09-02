import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";

/**
 * Refreshes the Supabase session on every request and writes the rotated auth
 * cookies onto the response. Server Components cannot set cookies, so without
 * this the session would silently expire mid-session.
 *
 * Note: this file is `proxy.ts`, not `middleware.ts` — Next.js 16 renamed the
 * convention (see node_modules/next/dist/docs/.../file-conventions/proxy.md).
 *
 * This is an optimistic check only. Real authorization lives next to the data:
 * the DAL in src/lib/dal.ts plus row-level security in Postgres.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Without credentials there is no session to refresh; let the page render and
  // show setup instructions.
  if (!isSupabaseConfigured) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() (not getSession()) revalidates the token with Supabase and
  // triggers the cookie refresh above when it has rotated.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthRoute = path.startsWith("/auth") || path.startsWith("/join");

  if (!user && !isAuthRoute && path !== "/") {
    const signIn = new URL("/", request.url);
    signIn.searchParams.set("next", path);
    return NextResponse.redirect(signIn);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimization.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
