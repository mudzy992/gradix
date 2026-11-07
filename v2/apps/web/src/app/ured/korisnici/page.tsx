import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import UsersClient from "./users-client";

export const dynamic = "force-dynamic";

/**
 * Server provjerava prije renderovanja: sesija → dozvola → obavezna promjena lozinke.
 * Klijent ne dobija ništa što nije prošlo ovu provjeru.
 */
export default async function UsersPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  // `authenticate` čita cookie kroz `request.cookies`, što postoji samo na NextRequest —
  // običan `Request` bi pao sa „Cannot read properties of undefined (reading 'get')“.
  const request = new NextRequest("http://interni/ured/korisnici", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");

  return (
    <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <UsersClient
        canManage={can(auth.ctx.roles, "users.manage")}
        actorId={auth.ctx.userId}
        actorIsOwner={auth.ctx.roles.includes("OWNER")}
      />
    </main>
  );
}
