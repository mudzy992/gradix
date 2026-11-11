/** Prikaz korisnika u okviru: bosanski nazivi rola i inicijali. */

export const ROLE_BS: Record<string, string> = {
  OWNER: "Vlasnik",
  ADMIN: "Administrator",
  PROJECT_MANAGER: "Vođa projekta",
  SITE_SUPERVISOR: "Šef gradilišta",
  WORKER: "Radnik",
  DRIVER: "Vozač",
  MACHINE_OPERATOR: "Rukovalac",
  MECHANIC: "Mehaničar",
  ACCOUNTANT: "Računovođa",
};

/** Prvo slovo imena i prezimena — isto u traci i u tabeli. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || "?";
}


