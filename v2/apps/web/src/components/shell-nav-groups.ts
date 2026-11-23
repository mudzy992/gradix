/**
 * Stanje otvorenosti grupa u sidebaru (L1, odluka A).
 * Aktivna grupa (stranica) je uvijek otvorena; ostale pamtimo u sessionStorage.
 */
export const NAV_GROUPS_STORAGE_KEY = "gx.nav.groups";

export type NavOpenMap = Record<string, boolean>;

export function readNavGroupOpenMap(): NavOpenMap {
  try {
    const raw = sessionStorage.getItem(NAV_GROUPS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: NavOpenMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeNavGroupOpenMap(map: NavOpenMap): void {
  try {
    sessionStorage.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* private mode / quota — collapse i dalje radi u memoriji */
  }
}

/** Spaja sessionStorage s pravilom: aktivna grupa je uvijek otvorena. */
export function resolveNavGroupOpenMap(input: {
  labels: readonly string[];
  activeLabel: string | null;
  stored: NavOpenMap;
}): NavOpenMap {
  const next: NavOpenMap = {};
  for (const label of input.labels) {
    if (label === input.activeLabel) {
      next[label] = true;
      continue;
    }
    next[label] = typeof input.stored[label] === "boolean" ? Boolean(input.stored[label]) : false;
  }
  return next;
}

export function findActiveGroupLabel(
  groups: readonly { label: string; items: readonly { href: string }[] }[],
  pathname: string,
): string | null {
  for (const group of groups) {
    const hit = group.items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
    if (hit) return group.label;
  }
  return null;
}
