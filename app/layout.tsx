import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QQQ / TQQQ Dashboard",
  description: "Lightweight QQQ & TQQQ price, volume, and % change dashboard powered by Massive.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
