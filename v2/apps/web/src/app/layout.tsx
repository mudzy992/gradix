import type { Metadata } from "next";
import "./globals.css";
import "@/components/density.css";

export const metadata: Metadata = {
  title: "Gradix",
  description: "Operativni sistem za niskogradnju",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Gustina je atribut, ne klasa po komponenti: `gusto` za ured, `udobno` za teren.
    <html lang="bs" data-density="gusto">
      <body>{children}</body>
    </html>
  );
}
