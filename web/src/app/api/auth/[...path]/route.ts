import { getAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

// Handlers are created on first request, not at module load — `next
// build` evaluates this module while collecting page data, and eager
// initialization would make the build require runtime secrets.
type RouteCtx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, ctx: RouteCtx): Promise<Response> {
  return getAuth().handler().GET(request, ctx);
}

export async function POST(request: Request, ctx: RouteCtx): Promise<Response> {
  return getAuth().handler().POST(request, ctx);
}
