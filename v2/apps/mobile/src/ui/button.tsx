/**
 * Dugme s metom ≥56 dp (A2): zasebna datoteka — `SignOutButton` ga uvozi odsud direktno,
 * bez barrela `ui/index.tsx`, da ciklus (index → SignOutButton → index) ne postoji.
 * forwardRef: Expo Router `Link asChild` prosljeđuje ref.
 */
import { forwardRef } from "react";
import { Pressable, Text as RNText, type PressableProps } from "react-native";
import { jedanStil } from "../lib/styles";
import { useUiStyles } from "./styles";

/** Dugme s metom ≥56 dp. forwardRef: Expo Router `Link asChild` prosljeđuje ref. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ref tip zavisi od RN verzije; Link asChild prosljeđuje ref
  export const Button = forwardRef<any, PressableProps & { label: string; variant?: "primary" | "secondary"; busy?: boolean }>(
  function Button({ label, variant = "primary", busy, disabled, style: _style, ...rest }, ref) {
    const { styles } = useUiStyles();
    const base = variant === "secondary" ? jedanStil(styles.button, styles.buttonSecondary) : styles.button;
    return (
      <Pressable ref={ref} disabled={disabled || busy} accessibilityRole={rest.accessibilityRole ?? "button"}
        style={jedanStil(base, disabled || busy ? styles.buttonDisabled : base)} {...rest}>
        <RNText style={variant === "secondary" ? styles.buttonTextSecondary : styles.buttonText}>{busy ? "Radim…" : label}</RNText>
      </Pressable>
    );
  },
);
