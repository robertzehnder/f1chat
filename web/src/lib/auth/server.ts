import { createNeonAuth, type NeonAuth } from "@neondatabase/auth/next/server";

// Managed Better Auth on the Neon project (enabled via neonctl; trusted
// domains: localhost:3000 + f1chat-sandy.vercel.app). The handler is
// mounted at /api/auth/[...path]; sessions ride first-party cookies
// signed with NEON_AUTH_COOKIE_SECRET.
//
// LAZY by design: Next evaluates route modules during `next build`
// ("Collecting page data"), and a module-level createNeonAuth() makes
// the BUILD demand runtime secrets — that broke the first Vercel deploy.
// Nothing here touches env until the first real request.
let _auth: NeonAuth | null = null;

export function getAuth(): NeonAuth {
  if (!_auth) {
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    const secret = process.env.NEON_AUTH_COOKIE_SECRET;
    if (!baseUrl || !secret) {
      throw new Error(
        "Neon Auth is not configured: set NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET"
      );
    }
    _auth = createNeonAuth({
      baseUrl,
      cookies: { secret }
    });
  }
  return _auth;
}

// Chat persistence is scoped by this id. Anonymous visitors keep the
// legacy shared 'guest' pool (migration 053's default) — that also keeps
// every cookie-less harness (sweeps, benchmarks, grading) working
// unchanged, and an unconfigured/unreachable auth service degrades to
// guest instead of breaking chat.
export async function getSessionUserId(): Promise<string> {
  try {
    const { data } = await getAuth().getSession();
    return data?.user?.id ?? "guest";
  } catch {
    return "guest";
  }
}

const GUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Browser-session guest identity from the x-guest-id header, as the
 *  namespaced user id it maps to — or null when absent/malformed. The
 *  'guest:' prefix is the security boundary: a header can never collide
 *  with a real account id. */
export function guestUserIdFromRequest(request: Request): string | null {
  const raw = request.headers.get("x-guest-id");
  return raw && GUEST_ID_RE.test(raw) ? `guest:${raw.toLowerCase()}` : null;
}

/**
 * The identity a request's chat data belongs to, in precedence order:
 *   1. signed-in account (session cookie)
 *   2. browser-session guest (x-guest-id header, sessionStorage-backed —
 *      chats live exactly as long as the visitor's web session)
 *   3. legacy shared 'guest' pool (cookie-less, header-less callers:
 *      sweeps, benchmarks, grading harnesses)
 */
export async function resolveEffectiveUserId(request: Request): Promise<string> {
  const sessionUserId = await getSessionUserId();
  if (sessionUserId !== "guest") {
    return sessionUserId;
  }
  return guestUserIdFromRequest(request) ?? "guest";
}
