import { AuthView } from "@neondatabase/auth/react/ui";

// Prebuilt Better Auth UI views (sign-in, sign-up, forgot-password,
// callback, sign-out, …) — the [pathname] segment selects the view.
// Email+password with OTP verification and Google (shared dev keys)
// are configured on the Neon Auth side.
export default async function AuthPage({
  params
}: {
  params: Promise<{ pathname: string }>;
}) {
  const { pathname } = await params;
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <AuthView pathname={pathname} redirectTo="/" />
    </main>
  );
}
