/**
 * Navigacijski tipovi ljuske (A2): `NavItem` živi ovdje da ljuska i paleta komandi
 * uvoze isti tip bez ciklusa (shell → shell-palette → shell).
 */
import type { IconName } from "./ui/primitives";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  description?: string;
  badge?: { count: number; older: number };
};
