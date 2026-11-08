/**
 * Server omotač okvira: iz sesije izvlači ime, firmu i role, pa gradi SAMO stavke koje
 * osoba smije otvoriti.
 *
 * Zašto filter ovdje, a ne u klijentu: meni koji nudi stavku koja vraća 403 je isti problem
 * kao dugme koje ne može proći. Ruta i dalje provjerava sve (guard), ovo je samo da se ne
 * nudi ono što je zabranjeno.
 *
 * Ako sesije nema, okvir se ne renderuje — stranica koja ga koristi ionako preusmjerava na
 * prijavu, pa ovdje nema drugog puta.
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { can } from "@/server/permissions";
import { withCompany } from "@gradix/db";
import { getVerifiedPool } from "@/server/db";
import Shell, { type NavGroup } from "./shell";

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return <>{children}</>;

  // `authenticate` čita cookie kroz `request.cookies` — samo NextRequest to ima.
  const request = new NextRequest("http://interni/okvir", { headers: { cookie: `${ACCESS_COOKIE}=${token}` } });
  const auth = await authenticate(request);
  if (!auth.ok) return <>{children}</>;

  const ctx = auth.ctx;
  const pool = await getVerifiedPool();

  const profile = await withCompany(pool, ctx.companyId, async (client) => {
    const result = await client.query<{ first_name: string; last_name: string; email: string; name: string }>(
      `SELECT u.first_name, u.last_name, u.email, c.name
         FROM users u JOIN companies c ON c.id = $2
        WHERE u.id = $1`,
      [ctx.userId, ctx.companyId],
    );
    return result.rows[0] ?? null;
  });

  const canManageUsers = can(ctx.roles, "users.manage");
  const canViewWorkers = can(ctx.roles, "workers.view");
  const canManageWorkers = can(ctx.roles, "workers.manage");
  const canViewEquipment = can(ctx.roles, "equipment.view");
  const canViewAudit = can(ctx.roles, "audit.view");
  const canViewRoles = can(ctx.roles, "roles.view");

  const groups: NavGroup[] = [
    {
      label: "Pregled",
      items: [{ href: "/pregled", label: "Pregled", icon: "home", description: "Mašine i offline zapisi" }],
    },
    {
      // Redoslijed je redoslijed rada: prvo ljudi i mašine, pa uvoz kad se prelazi sa papira.
      label: "Evidencija",
      items: [
        ...(canViewEquipment
          ? [
              {
                href: "/ured/masine",
                label: "Mašine i vozila",
                icon: "truck" as const,
                description: "Inventar, kategorije, brojilo",
              },
            ]
          : []),
        ...(canViewWorkers
          ? [
              {
                href: "/ured/radnici",
                label: "Radnici",
                icon: "users" as const,
                description: "Ljudi, kontakt, angažman",
              },
            ]
          : []),
        ...(canManageWorkers
          ? [{ href: "/ured/uvoz", label: "Uvoz iz Excela", icon: "upload" as const, description: "Spisak sa papira" }]
          : []),
      ],
    },
    {
      label: "Ured",
      items: [
        ...(canManageUsers
          ? [{ href: "/ured/korisnici", label: "Korisnici", icon: "users" as const, description: "Ljudi, role, pristup" }]
          : []),
        ...(canViewRoles
          ? [{ href: "/ured/role", label: "Pristup i role", icon: "shield" as const, description: "Ko šta smije" }]
          : []),
        ...(canViewAudit
          ? [{ href: "/ured/audit", label: "Audit trag", icon: "list" as const, description: "Ko je šta mijenjao" }]
          : []),
      ],
    },
  ].filter((group) => group.items.length > 0);

  // Ime za header: ime i prezime iz baze, ne iz tokena (token nosi samo id).
  const displayName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : "Korisnik";

  return (
    <Shell
      groups={groups}
      user={{
        displayName,
        email: profile?.email ?? "",
        companyName: profile?.name ?? "Firma",
        roles: ctx.roles,
      }}
    >
      {children}
    </Shell>
  );
}
