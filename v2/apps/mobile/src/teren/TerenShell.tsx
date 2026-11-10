import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { spacing, touchTarget, typography, radius } from "../theme/tokens";
import { useTheme } from "../theme/use-theme";
import { jedanStil } from "../lib/styles";
import { SignOutButton } from "./SignOutButton";

/** Zajednički okvir terenskih ekrana: učitavanje, greška i prazno stanje uvijek isto izgledaju. */
export function TerenShell(props: {
  title: string;
  subtitle: string;
  loading: boolean;
  error: string | null;
  empty: string | null;
  children: ReactNode;
  onRetry?: () => void;
}) {
  const { theme } = useTheme();
  const styles = createStyles(theme);
  if (props.loading) {
    return (
      <View style={styles.center} accessibilityLabel="Učitavanje">
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={styles.muted}>Učitavanje…</Text>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{props.title}</Text>
      <Text style={styles.subtitle}>{props.subtitle}</Text>
      {props.error ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{props.error}</Text>
          {props.onRetry ? (
            <Pressable onPress={props.onRetry} accessibilityRole="button" style={jedanStil(styles.retry)}>
              <Text style={styles.retryText}>Pokušaj ponovo</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {props.empty && !props.error ? (
        <View style={styles.emptyBox}>
          <Text style={styles.muted}>{props.empty}</Text>
        </View>
      ) : null}
      {props.children}
      <SignOutButton />
    </ScrollView>
  );
}

export function createStyles(t: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, backgroundColor: t.bg },
    container: { padding: spacing.xl, gap: spacing.md, backgroundColor: t.bg, flexGrow: 1 },
    title: { ...typography.page, color: t.text },
    subtitle: { ...typography.body, color: t.muted },
    muted: { ...typography.body, color: t.muted },
    text: { ...typography.body, color: t.text },
    label: { ...typography.label, color: t.text, marginTop: spacing.sm },
    errorBox: { padding: spacing.md, borderRadius: radius.field, backgroundColor: t.dangerSoft, gap: spacing.sm },
    errorText: { ...typography.body, color: t.danger },
    emptyBox: { padding: spacing.lg, borderRadius: radius.card, borderWidth: 1, borderColor: t.line, backgroundColor: t.panel },
    retry: { minHeight: touchTarget, justifyContent: "center" },
    retryText: { ...typography.button, color: t.danger },
    banner: { padding: spacing.md, borderRadius: radius.field, backgroundColor: t.warnSoft },
    bannerText: { ...typography.body, color: t.text },
    card: { padding: spacing.lg, borderRadius: radius.card, borderWidth: 1, borderColor: t.line, backgroundColor: t.panel, gap: spacing.sm },
    input: {
      borderWidth: 1, borderColor: t.field, borderRadius: radius.field, paddingHorizontal: spacing.md,
      minHeight: touchTarget, ...typography.body, color: t.text, backgroundColor: t.panel,
    },
    button: { backgroundColor: t.primary, borderRadius: radius.card, minHeight: touchTarget, alignItems: "center", justifyContent: "center", padding: spacing.md },
    buttonText: { ...typography.button, color: t.onPrimary },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    chip: { borderWidth: 1, borderColor: t.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, minHeight: 40, justifyContent: "center" },
    chipOn: { backgroundColor: t.tint },
    chipText: { ...typography.label, color: t.text },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
    rowText: { flex: 1, ...typography.body, color: t.text },
    outcome: { ...typography.label, color: t.muted },
  });
}
