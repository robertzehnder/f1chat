import { createNeonAuth } from "@neondatabase/auth/next/server";

// Managed Better Auth on the Neon project (enabled via neonctl; trusted
// domains: localhost:3000 + f1chat-sandy.vercel.app). The handler is
// mounted at /api/auth/[...path]; sessions ride first-party cookies
// signed with NEON_AUTH_COOKIE_SECRET.
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!
  }
});

// Chat persistence is scoped by this id. Anonymous visitors keep the
// legacy shared 'guest' pool (migration 053's default) — that also keeps
// every cookie-less harness (sweeps, benchmarks, grading) working
// unchanged. Signed-in users get private, per-account conversations.
export async function getSessionUserId(): Promise<string> {
  try {
    const { data } = await auth.getSession();
    return data?.user?.id ?? "guest";
  } catch {
    return "guest";
  }
}
