/**
 * Tema za mobilni: prati sistem, može se ručno promijeniti.
 *
 * Isto pravilo kao na webu (`useTheme` u `apps/web/src/components/shell.tsx`) — jedina razlika
 * je skladište: izbor ide kroz `lib/store` (na uređaju Keychain preko `expo-secure-store`,
 * na webu `localStorage`). Dok se izbor ne pročita, koristi se sistem.
 */
import { useColorScheme } from "react-native";
import { useEffect, useState } from "react";
import { deleteStore, readStore, writeStore } from "../lib/store";
import { themes, type ThemeName, type ThemeTokens } from "./tokens";

const THEME_KEY = "gx-theme";
export type ThemeChoice = ThemeName | "system";

export function useTheme(): {
  theme: ThemeTokens;
  name: ThemeName;
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
  toggle: () => void;
} {
  const system = useColorScheme();
  const [choice, setChoiceState] = useState<ThemeChoice>("system");

  useEffect(() => {
    let active = true;
    void readStore(THEME_KEY)
      .then((stored) => {
        if (active && (stored === "light" || stored === "dark")) setChoiceState(stored);
      })
      .catch(() => {
        // Bez skladišta tema prati sistem — nema razloga da ekran padne zbog boje.
      });
    return () => {
      active = false;
    };
  }, []);

  const name: ThemeName = choice === "system" ? (system === "dark" ? "dark" : "light") : choice;

  function setChoice(next: ThemeChoice) {
    setChoiceState(next);
    if (next === "system") void deleteStore(THEME_KEY);
    else void writeStore(THEME_KEY, next);
  }

  return {
    theme: themes[name],
    name,
    choice,
    setChoice,
    toggle: () => setChoice(name === "dark" ? "light" : "dark"),
  };
}
