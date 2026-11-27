"use client";

/** Tema okvira: svijetla/tamna/sistem — izbor se pamti u localStorage. */
import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const THEME_KEY = "gx-theme";

/**
 * Tema: prati sistem, osim kad je korisnik ručno izabrao. Izbor se pamti u `localStorage`;
 * „prati sistem“ briše ključ (tada odluku ponovo nosi `prefers-color-scheme`).
 * Prvo iscrtavanje rješava inline skripta u `layout.tsx` — ovdje se samo održava stanje.
 */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY);
    const initial: ThemeChoice = stored === "light" || stored === "dark" ? stored : "system";
    setChoice(initial);
    setResolved(initial === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : initial);
  }, []);

  useEffect(() => {
    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setResolved(media.matches ? "dark" : "light");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [choice]);

  const apply = useCallback((next: ThemeChoice) => {
    setChoice(next);
    const effective =
      next === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : next;
    setResolved(effective);
    // Atribut na <html> — isto mjesto koje čita inline skripta pri sljedećem učitavanju.
    document.documentElement.dataset.theme = effective;
    if (next === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, next);
  }, []);

  return { choice, resolved, apply };
}

