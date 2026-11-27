import Link from "next/link";
import { Card } from "@/components/ui/index";
import { can, type Permission } from "@/server/permissions";

type Step = { label: string; href: string; permission: Permission | "authenticated" };
const common: Step[] = [
  { label: "Provjerite svoj profil i sigurnost", href: "/ured/profil", permission: "authenticated" },
  { label: "Pogledajte obavještenja", href: "/ured/obavjestenja", permission: "authenticated" },
  { label: "Vratite se na pregled", href: "/pregled", permission: "authenticated" },
];
const steps: Record<string, Step[]> = {
  OWNER: [
    { label: "Otvorite projekte i dodajte prvi projekat", href: "/ured/projekti", permission: "projects.manage" },
    { label: "Dodajte radnike u evidenciju", href: "/ured/radnici", permission: "workers.manage" },
    { label: "Pozovite članove tima", href: "/ured/korisnici", permission: "users.manage" },
  ],
  PROJECT_MANAGER: [
    { label: "Pregledajte dodijeljene projekte", href: "/ured/projekti", permission: "projects.view" },
    { label: "Pregledajte zadatke", href: "/ured/zadaci", permission: "projects.view" },
    { label: "Provjerite rokove", href: "/ured/rokovi", permission: "obligations.view" },
  ],
  SITE_SUPERVISOR: [
    { label: "Pregledajte radne dane", href: "/ured/radni-dani", permission: "workdays.view" },
    { label: "Otvorite dnevnik građenja", href: "/ured/dnevnik", permission: "diary.view" },
    { label: "Provjerite zadatke", href: "/ured/zadaci", permission: "projects.view" },
  ],
  ACCOUNTANT: [
    { label: "Otvorite obračun", href: "/ured/obracun-sati", permission: "payroll.view" },
    { label: "Provjerite radne dane", href: "/ured/radni-dani", permission: "workdays.view" },
    { label: "Pogledajte izvještaje", href: "/ured/izvjestaji", permission: "reports.view" },
  ],
  MECHANIC: [
    { label: "Otvorite servisne naloge", href: "/ured/servis", permission: "service.view" },
    { label: "Provjerite planove servisa", href: "/ured/servis/planovi", permission: "service.view" },
    { label: "Pregledajte kvarove", href: "/ured/kvarovi", permission: "machines.fault.view" },
  ],
};
export function GettingStarted({ roles }: { roles: readonly string[] }) {
  const key = roles.includes("OWNER") || roles.includes("ADMIN") ? "OWNER" : roles.find(role => steps[role]) ?? "";
  const visible = [...(steps[key] ?? []), ...common].filter(step => step.permission === "authenticated" || can(roles, step.permission)).slice(0, 3);
  return <Card><h2 className="gx-section-title">Počnite u tri koraka</h2>
    <p className="gx-page-sub">Koraci za upoznavanje funkcija dostupnih u vašoj ulozi.</p>
    <ol className="gx-stack gx-stack--2">{visible.map(step => <li key={step.href}><Link href={step.href}>{step.label}</Link></li>)}</ol>
  </Card>;
}
