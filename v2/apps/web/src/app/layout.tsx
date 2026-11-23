import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import AppShell from "@/components/app-shell";
import "./globals.css";
import "./shell.css";

/**
 * Fontovi (DESIGN.md „Tipografija“): Manrope za interfejs, IBM Plex Mono za brojeve, šifre i
 * vrijeme. `next/font/local` — woff2 je u repou (`src/fonts`), pa nema zahtjeva prema
 * Google Fonts u toku rada ni u build-u (sandbox ne dohvata fonts.googleapis.com).
 *
 * Varijabilni Manrope pokriva 200–800 jednim fajlom; mono je jedan rez (500) — to je sve što
 * referenca koristi. `display: swap` jer je tekst čitljiv i prije nego font stigne.
 */
const manrope = localFont({
  src: [
    { path: "../fonts/manrope-latin.woff2", weight: "200 800", style: "normal" },
    { path: "../fonts/manrope-latin-ext.woff2", weight: "200 800", style: "normal" },
  ],
  variable: "--font-manrope",
  display: "swap",
  fallback: ["Segoe UI", "system-ui", "sans-serif"],
});

const plexMono = localFont({
  src: [
    { path: "../fonts/plex-mono-latin-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/plex-mono-latin-ext-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  fallback: ["ui-monospace", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: "Gradix",
  description: "Operativni sistem za niskogradnju",
};

export const viewport: Viewport = {
  // Boja trake preglednika prati temu (svijetla/tamna) — inače bijela traka „siječe“ tamnu.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f4" },
    { media: "(prefers-color-scheme: dark)", color: "#1b232a" },
  ],
};

/**
 * Tema se postavlja PRIJE prvog iscrtavanja, inline skriptom.
 *
 * Zašto ne u `useEffect`: tada bi prvo iscrtala svijetla tema pa se prebacila na tamnu —
 * treperenje koje je vidljivo i iritantno. Redoslijed: ručni izbor iz `localStorage`, inače
 * `prefers-color-scheme`. Ručni izbor pamti se kao `light`/`dark`; „prati sistem“ briše ključ.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("gx-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="light";}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bs" data-theme="light" className={`${manrope.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/* Okvir je na jednom mjestu: sidebar + velika ploča. Stranice ne crtaju svoju
            navigaciju — inače bi svaka nova stranica ponovo izmišljala istu stvar. */}
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
