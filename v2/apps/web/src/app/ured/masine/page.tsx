import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import EquipmentClient from "./equipment-client";

export const dynamic = "force-dynamic";

/**
 * Mašine — `equipment.view` je dovoljan za ekran; izmjene traže `equipment.manage`.
 * Rukovalac i mehaničar vide inventar i upisuju brojilo (PATCH traži `equipment.view`),
 * ali ne mijenjaju podatke o mašini.
 */
export default async function EquipmentPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/masine", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "equipment.view")) redirect("/nemate-pristup");

  return (
    <main className="mx-auto w-full max-w-6xl">
      <EquipmentClient canManage={can(auth.ctx.roles, "equipment.manage")} />
    </main>
  );
}
