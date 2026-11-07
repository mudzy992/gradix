import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gradix",
  description: "Operativni sistem za niskogradnju",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bs">
      <body>{children}</body>
    </html>
  );
}
