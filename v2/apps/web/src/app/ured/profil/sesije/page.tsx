import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import SessionsClient from "./sessions-client";

export const dynamic = "force-dynamic";

/** Moje sesije / moji uređaji (spec 01 §1.6.28). Svako vidi svoje — nema posebne dozvole. */
export default async function SessionsPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/profil/sesije", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");

  return (
    <main className="mx-auto w-full max-w-3xl">
      <SessionsClient />
    </main>
  );
}
