"use client";
// Historically a guest-only shim — now backed by Neon Auth (managed
// Better Auth). The module name is kept so consumers don't churn; the
// useAuth() contract is unchanged: user is null while signed out,
// loading is true during the initial session fetch.
import { type ReactNode } from "react";
import { authClient } from "@/lib/auth/client";

export type AuthUser = { id: string; name: string; email: string | null };

export function useAuth(): {
  user: AuthUser | null;
  signOut: () => void;
  loading: boolean;
} {
  const { data, isPending } = authClient.useSession();
  const user: AuthUser | null = data?.user
    ? {
        id: data.user.id,
        name: data.user.name || data.user.email || "User",
        email: data.user.email ?? null
      }
    : null;
  return {
    user,
    signOut: () => {
      void authClient.signOut().then(() => {
        window.location.assign("/");
      });
    },
    loading: isPending
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
