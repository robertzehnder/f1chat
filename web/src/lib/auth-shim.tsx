"use client";
import { createContext, useContext, type ReactNode } from "react";

export type AuthUser = { id: string; name: string; email: string | null };
type AuthCtx = { user: AuthUser | null; signOut: () => void; loading: boolean };

const guest: AuthUser = { id: "guest", name: "Guest", email: null };
const ctx = createContext<AuthCtx>({ user: guest, signOut: () => {}, loading: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <ctx.Provider value={{ user: guest, signOut: () => {}, loading: false }}>
      {children}
    </ctx.Provider>
  );
}

export function useAuth() {
  return useContext(ctx);
}
