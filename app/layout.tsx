import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Process Recording → Test Script",
  description: "Upload a screen recording and get a documented test script with screenshots.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
