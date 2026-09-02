import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Google redirects here after consent. Exchanges the one-time code for a
 * session and drops the user where they were headed.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");

  // Only allow same-site redirects, so a crafted link can't bounce someone off
  // to another domain carrying their fresh session.
  const requested = searchParams.get("next") ?? "/";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent(oauthError)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent("Sign-in did not complete. Please try again.")}`,
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
