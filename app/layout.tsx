import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "S&A QQQ/TQQQ Analytics",
  description: "9:30-4:00 ET volume for QQQ and TQQQ in 15-minute buckets, with a realized-volatility proxy derived from QQQ's own price range.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
