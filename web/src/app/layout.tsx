import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import { AppChrome } from "@/components/AppChrome";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans"
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono"
});

export const metadata: Metadata = {
  title: "OpenF1 Explorer",
  description: "Structured + conversational exploration for local OpenF1 PostgreSQL data."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${ibmPlexMono.variable}`}>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
