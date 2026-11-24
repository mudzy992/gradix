import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import NotificationsClient from "./notifications-client";

export const dynamic = "force-dynamic";

/**
 * Inbox obavještenja (F0.4).
 *
 * Nema posebne dozvole: svako ima pravo na SVOJ inbox. Tuđa obavještenja ionako ne postoje
 * za ovaj upit (`user_id` ILI `role_target`), a RLS drži firmu.
 */
export default async function NotificationsPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/obavjestenja", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");

  return (
    <main className="mx-auto w-full max-w-4xl">
      <NotificationsClient />
    </main>
  );
}
