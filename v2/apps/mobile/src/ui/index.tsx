/**
 * U2 — mobilni UI sistem: jedini izvor stilova za ekrane. Ekrani (src/app, src/teren)
 * NE smiju imati StyleSheet.create, TextInput ni Pressable van ovog modula (ESLint U3).
 * Sve boje/veličine dolaze iz theme tokena; mete dodira ≥56 dp.
 */
import { type ReactNode } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, Text as RNText, TextInput, View,
  type TextInputProps, type TextStyle,
} from "react-native";
import { typography } from "../theme/tokens";
import { jedanStil } from "../lib/styles";
import { useUiStyles } from "./styles";
import { SignOutButton } from "./SignOutButton";

export { makeStyles, useUiStyles, type UiStyles } from "./styles";
export { Button } from "./button";
export { SignOutButton, logoutExplanation } from "./SignOutButton";

export function Text({ variant = "body", children, style }: { variant?: "page" | "body" | "muted" | "label" | "caption"; children: ReactNode; style?: TextStyle }) {
  const { styles } = useUiStyles();
  const base = variant === "page" ? styles.title : variant === "muted" ? styles.muted : variant === "label" ? styles.label : variant === "caption" ? styles.caption : styles.body;
  return <RNText style={style ? [base, style] : base}>{children}</RNText>;
}

export function Screen(props: { title: string; subtitle: string; loading: boolean; error: string | null; empty: string | null; children: ReactNode; onRetry?: () => void; onBack?: () => void }) {
  const { styles, theme } = useUiStyles();
  if (props.loading) {
    return (
      <View style={styles.center} accessibilityLabel="Učitavanje">
        <ActivityIndicator size="large" color={theme.primary} />
        <RNText style={styles.muted}>Učitavanje…</RNText>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.container}>
      {props.onBack ? <TextLink label="‹ Nazad" onPress={props.onBack} /> : null}
      <RNText style={styles.title}>{props.title}</RNText>
      <RNText style={styles.subtitle}>{props.subtitle}</RNText>
      {props.error ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <RNText style={styles.errorText}>{props.error}</RNText>
          {props.onRetry ? (
            <Pressable onPress={props.onRetry} accessibilityRole="button" style={jedanStil(styles.retry)}>
              <RNText style={styles.retryText}>Pokušaj ponovo</RNText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {props.empty && !props.error ? (
        <View style={styles.emptyBox}><RNText style={styles.muted}>{props.empty}</RNText></View>
      ) : null}
      {props.children}
      <SignOutButton />
    </ScrollView>
  );
}

export function BigActionButton(props: { label: string; hint?: string; onPress: () => void; disabled?: boolean }) {
  const { styles } = useUiStyles();
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} accessibilityRole="button" style={jedanStil(styles.button, props.disabled ? styles.buttonDisabled : styles.button)}>
      <RNText style={styles.buttonText}>{props.label}</RNText>
      {props.hint ? <RNText style={styles.buttonText}>{props.hint}</RNText> : null}
    </Pressable>
  );
}

export function TextField(props: { label: string } & TextInputProps) {
  const { styles, theme } = useUiStyles();
  const { label, ...input } = props;
  return (
    <View>
      <RNText style={styles.label}>{label}</RNText>
      <TextInput placeholderTextColor={theme.muted} style={styles.input} accessibilityLabel={props.accessibilityLabel ?? label} {...input} />
    </View>
  );
}

export function Segmented<T extends string>(props: {
  label: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void;
}) {
  const { styles } = useUiStyles();
  return (
    <View>
      <RNText style={styles.label}>{props.label}</RNText>
      <View style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel={props.label}>
        {props.options.map((option) => (
          <Pressable key={option.value} onPress={() => props.onChange(option.value)} accessibilityRole="radio"
            accessibilityState={{ selected: props.value === option.value }}
            style={jedanStil(styles.chip, props.value === option.value ? styles.chipOn : styles.chip)}>
            <RNText style={styles.chipText}>{option.label}</RNText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function CheckboxRow(props: { label: string; checked: boolean; onToggle: () => void; right?: string }) {
  const { styles } = useUiStyles();
  return (
    <Pressable onPress={props.onToggle} accessibilityRole="checkbox" accessibilityState={{ checked: props.checked }} style={styles.row}>
      <View style={jedanStil(styles.chip, props.checked ? styles.chipOn : styles.chip)}>
        <RNText style={styles.chipText}>{props.checked ? "✓" : " "}</RNText>
      </View>
      <RNText style={styles.rowText}>{props.label}</RNText>
      {props.right ? <RNText style={styles.outcome}>{props.right}</RNText> : null}
    </Pressable>
  );
}

export function ListItem(props: { title: string; meta?: string; right?: string }) {
  const { styles } = useUiStyles();
  return (
    <View style={styles.row}>
      <RNText style={styles.rowText}>{props.title}</RNText>
      {props.meta ? <RNText style={styles.caption}>{props.meta}</RNText> : null}
      {props.right ? <RNText style={styles.outcome}>{props.right}</RNText> : null}
    </View>
  );
}

export function StatusChip({ label, tone }: { label: string; tone?: "warn" | "plain" }) {
  const { styles } = useUiStyles();
  return (
    <View style={jedanStil(styles.chip, tone === "warn" ? styles.chipOn : styles.chip)}>
      <RNText style={styles.chipText}>{label}</RNText>
    </View>
  );
}

export function Banner({ children }: { children: ReactNode }) {
  const { styles } = useUiStyles();
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <RNText style={styles.bannerText}>{children}</RNText>
    </View>
  );
}

export function AlertBox({ children }: { children: ReactNode }) {
  const { styles } = useUiStyles();
  return (
    <View style={styles.errorBox} accessibilityRole="alert">
      <RNText style={styles.errorText}>{children}</RNText>
    </View>
  );
}

export function EmptyState({ text }: { text: string }) {
  const { styles } = useUiStyles();
  return (
    <View style={styles.emptyBox}><RNText style={styles.muted}>{text}</RNText></View>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  const { styles } = useUiStyles();
  return (
    <View style={styles.card} accessibilityLabel="Učitavanje">
      {Array.from({ length: rows }, (_, i) => <View key={i} style={styles.skeleton} />)}
    </View>
  );
}

export function CardView({ children }: { children: ReactNode }) {
  const { styles } = useUiStyles();
  return <View style={styles.card}>{children}</View>;
}

export function Tile(props: { title: string; hint?: string; onPress: () => void }) {
  const { styles } = useUiStyles();
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" style={styles.tile}>
      <RNText style={styles.body}>{props.title}</RNText>
      {props.hint ? <RNText style={styles.caption}>{props.hint}</RNText> : null}
    </Pressable>
  );
}

/* --- Proširenje kataloga (paritet s webom): Avatar, Badge, Accordion, Stepper,
       Link, Upload, Image, Toast, Breadcrumbs. Stilovi i dalje samo ovdje, iz tokena. */
import { Image as RNImage } from "react-native";
import { useState as useStateUi } from "react";

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const { theme } = useUiStyles();
  const initials = name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.tint, alignItems: "center", justifyContent: "center" }}>
      <RNText style={{ color: theme.text, fontWeight: "700" }}>{initials}</RNText>
    </View>
  );
}

export function Badge({ label, tone = "primary" }: { label: string; tone?: "primary" | "danger" | "quiet" }) {
  const { theme } = useUiStyles();
  const bg = tone === "danger" ? theme.danger : tone === "quiet" ? theme.sunken : theme.primary;
  const fg = tone === "quiet" ? theme.text : theme.onPrimary;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 8, minWidth: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
      <RNText style={{ ...typography.label, color: fg }}>{label}</RNText>
    </View>
  );
}

export function Accordion({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useStateUi(false);
  const { styles } = useUiStyles();
  return (
    <View style={styles.card}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.row}>
        <RNText style={styles.rowText}>{title}</RNText>
        <RNText style={styles.outcome}>{open ? "▾" : "▸"}</RNText>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  const { styles, theme } = useUiStyles();
  return (
    <View style={styles.chipRow} accessibilityLabel="Koraci">
      {steps.map((step, index) => (
        <View key={step} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: index === current ? theme.primary : theme.sunken }}>
            <RNText style={{ color: index === current ? theme.onPrimary : theme.text, fontWeight: "700" }}>{index < current ? "✓" : index + 1}</RNText>
          </View>
          <RNText style={index === current ? styles.body : styles.caption}>{step}</RNText>
        </View>
      ))}
    </View>
  );
}

export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme } = useUiStyles();
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={{ minHeight: 40, justifyContent: "center" }}>
      <RNText style={{ color: theme.link, fontWeight: "600", textDecorationLine: "underline" }}>{label}</RNText>
    </Pressable>
  );
}

export function UploadTile({ label, hint, onPress }: { label: string; hint?: string; onPress: () => void }) {
  return <Tile title={label} hint={hint ?? "Dodaj fotografiju ili dokument"} onPress={onPress} />;
}

export function ImageTile({ uri, caption }: { uri: string; caption?: string }) {
  const { styles } = useUiStyles();
  return (
    <View style={styles.card}>
      <RNImage source={{ uri }} style={{ width: "100%", height: 160, borderRadius: 12 }} accessibilityLabel={caption ?? "Slika"} />
      {caption ? <RNText style={styles.caption}>{caption}</RNText> : null}
    </View>
  );
}

export function ToastBanner({ text, tone = "info", onClose }: { text: string; tone?: "info" | "error"; onClose?: () => void }) {
  const { styles } = useUiStyles();
  if (tone === "error") return <AlertBox>{text}</AlertBox>;
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <RNText style={styles.bannerText}>{text}</RNText>
      {onClose ? (
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Zatvori obavijest" style={styles.retry}>
          <RNText style={styles.retryText}>Zatvori</RNText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Breadcrumbs({ items }: { items: string[] }) {
  const { styles } = useUiStyles();
  return (
    <View style={styles.chipRow} accessibilityLabel="Putanja">
      {items.map((item, index) => (
        <RNText key={item} style={index === items.length - 1 ? styles.body : styles.caption}>
          {index > 0 ? "/ " : ""}{item}
        </RNText>
      ))}
    </View>
  );
}
