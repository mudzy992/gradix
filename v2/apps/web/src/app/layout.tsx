import type { Metadata } from "next";
import AppShell from "@/components/app-shell";
import "./globals.css";
import "./shell.css";
import "@/components/density.css";

export const metadata: Metadata = {
  title: "Gradix",
  description: "Operativni sistem za niskogradnju",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Gustina je atribut, ne klasa po komponenti: `gusto` za ured, `udobno` za teren.
    <html lang="bs" data-density="gusto">
      <body>
        {/* Okvir (R1c) je na jednom mjestu: sidebar + header. Stranice ne crtaju svoju
            navigaciju — inače bi svaka nova stranica ponovo izmišljala istu stvar. */}
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
