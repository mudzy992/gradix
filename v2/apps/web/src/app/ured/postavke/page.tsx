import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import PostavkeClient from "./postavke-client";

export const dynamic = "force-dynamic";

/**
 * Postavke firme (F1). Server provjerava prije renderovanja — klijent ne dobija ništa što
 * nije prošlo sesiju, obaveznu promjenu lozinke i dozvolu `company.settings.view`.
 */
export default async function PostavkePage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/postavke", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "company.settings.view")) redirect("/nemate-pristup");

  return (
    <main className="mx-auto w-full max-w-5xl">
      <PostavkeClient canManage={can(auth.ctx.roles, "company.settings.manage")} />
    </main>
  );
}
