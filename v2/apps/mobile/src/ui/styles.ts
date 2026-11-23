/**
 * Dijeljeni stilovi mobilnog UI-ja (A2): zasebna datoteka da `Button` i `SignOutButton`
 * mogu uvoziti stilove iz KONKRETNE datoteke, a ne iz `ui/index.tsx` — barrel bi vratio
 * ciklus (index → SignOutButton → index). Ekrani i dalje uvoze sve iz `../ui`.
 */
import { StyleSheet } from "react-native";
import { radius, spacing, touchTarget, typography } from "../theme/tokens";
import { useTheme } from "../theme/use-theme";
import type { ThemeTokens } from "../theme/tokens";

export function makeStyles(t: ThemeTokens) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, backgroundColor: t.bg },
    container: { padding: spacing.xl, gap: spacing.md, backgroundColor: t.bg, flexGrow: 1 },
    title: { ...typography.page, color: t.text },
    subtitle: { ...typography.body, color: t.muted },
    muted: { ...typography.body, color: t.muted },
    body: { ...typography.body, color: t.text },
    label: { ...typography.label, color: t.text, marginTop: spacing.sm },
    caption: { ...typography.label, color: t.muted },
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
    buttonSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: t.line },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { ...typography.button, color: t.onPrimary },
    buttonTextSecondary: { ...typography.button, color: t.text },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    chip: { borderWidth: 1, borderColor: t.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, minHeight: 40, justifyContent: "center" },
    chipOn: { backgroundColor: t.tint },
    chipText: { ...typography.label, color: t.text },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
    rowText: { ...typography.body, color: t.text, flex: 1 },
    outcome: { ...typography.label, color: t.text },
    tile: { padding: spacing.lg, borderRadius: radius.tile, borderWidth: 1, borderColor: t.line, backgroundColor: t.panel, gap: spacing.xs },
    skeleton: { height: spacing.lg, borderRadius: radius.field, backgroundColor: t.sunken },
    topRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
    themeBtn: { minHeight: 40, paddingHorizontal: spacing.md, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: t.line },
  });
}
export type UiStyles = ReturnType<typeof makeStyles>;
export function useUiStyles(): { styles: UiStyles; theme: ThemeTokens } {
  const { theme } = useTheme();
  return { styles: makeStyles(theme), theme };
}
