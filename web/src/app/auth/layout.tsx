import "@neondatabase/auth/ui/css";
import { AuthShell } from "./auth-shell";

export default function AuthLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return <AuthShell>{children}</AuthShell>;
}
