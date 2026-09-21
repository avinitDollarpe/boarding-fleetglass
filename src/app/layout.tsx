import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fleetglass",
  description: "API that wakes Richard from Slack and GitHub.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
