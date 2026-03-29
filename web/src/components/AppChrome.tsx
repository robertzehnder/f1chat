"use client";

import { usePathname } from "next/navigation";
import { Nav } from "@/components/Nav";

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isChat = pathname === "/chat";

  if (isChat) {
    return (
      <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-canvas">
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Nav />
      <main className="main-content">{children}</main>
    </div>
  );
}
