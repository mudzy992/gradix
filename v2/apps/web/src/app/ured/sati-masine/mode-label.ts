/** Bosnian labels for machine work-log modes (R5.1). */
const MODE_LABELS: Record<string, string> = {
  WORK: "Rad",
  IDLE: "Mirovanje",
  BREAKDOWN: "Kvar",
};

export function modeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? mode;
}