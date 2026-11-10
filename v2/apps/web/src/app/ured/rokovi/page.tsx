import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import ObligationsClient from "./obligations-client";

export const dynamic = "force-dynamic";

/** Rokovi — `obligations.view` za listu, `obligations.manage` za unos, obnovu i priloge. */
export default async function ObligationsPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/rokovi", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "obligations.view")) redirect("/nemate-pristup");

  return (
    <main className="mx-auto w-full max-w-6xl">
      <ObligationsClient canManage={can(auth.ctx.roles, "obligations.manage")} />
    </main>
  );
}
