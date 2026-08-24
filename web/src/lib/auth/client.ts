"use client";

import { createAuthClient } from "@neondatabase/auth/next";

// Standard better-auth react client pointed at /api/auth — gives
// useSession(), signIn.email/social, signUp.email, signOut.
export const authClient = createAuthClient();
