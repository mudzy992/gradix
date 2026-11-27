import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import RolesClient from "./roles-client";

export const dynamic = "force-dynamic";

/** Ista provjera kao svaki zaštićeni ekran: sesija → dozvola → obavezna promjena lozinke. */
export default async function RolesPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  // `authenticate` čita cookie kroz `request.cookies` — samo NextRequest to ima.
  const request = new NextRequest("http://interni/ured/role", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "roles.view")) redirect("/nemate-pristup");

  return (
    <main className="mx-auto w-full max-w-6xl">
      <RolesClient />
    </main>
  );
}
