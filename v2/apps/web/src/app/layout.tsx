import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gradix",
  description: "Operativni sistem za niskogradnju",
  // `public/favicon.png` je i u gitu i u slici: ranije je `public/` bio prazan
  // direktorij, git ga nije pratio, pa je Docker build padao na COPY (docs/COOLIFY.md §9).
  icons: { icon: "/favicon.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bs">
      <body>{children}</body>
    </html>
  );
}
