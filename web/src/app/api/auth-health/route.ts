import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Deployment diagnostic: reports whether the Neon Auth env vars are
// PRESENT and well-formed in this runtime — never their values. Exists
// because "the var is set in the dashboard" and "the runtime sees a
// usable value" differ in practice (wrong environment scope, pasted
// quotes, trailing newlines).
export async function GET(): Promise<NextResponse> {
  const baseUrl = process.env.NEON_AUTH_BASE_URL ?? "";
  const secret = process.env.NEON_AUTH_COOKIE_SECRET ?? "";
  let baseUrlParses = false;
  let baseUrlHost = "";
  try {
    const u = new URL(baseUrl);
    baseUrlParses = true;
    baseUrlHost = u.host;
  } catch {
    // leave false
  }
  return NextResponse.json({
    baseUrlSet: baseUrl.length > 0,
    baseUrlParses,
    baseUrlHost,
    baseUrlHasWhitespaceOrQuotes: /\s|["']/.test(baseUrl),
    secretSet: secret.length > 0,
    secretLength: secret.length,
    secretHasWhitespaceOrQuotes: /\s|["']/.test(secret)
  });
}
