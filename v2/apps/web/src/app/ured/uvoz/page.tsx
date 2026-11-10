import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { can } from "@/server/permissions";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import ImportClient from "./import-client";

export const dynamic = "force-dynamic";

/**
 * Uvoz traži `workers.manage` (ista dozvola kao `POST /api/imports/*`).
 * Ekran ne nudi ništa što API ne bi prihvatio; provjera je ipak na serveru, prije renderovanja.
 */
export default async function ImportPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/uvoz", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "workers.manage")) redirect("/nemate-pristup");

  return (
    <main className="mx-auto w-full max-w-6xl">
      <ImportClient />
    </main>
  );
}
