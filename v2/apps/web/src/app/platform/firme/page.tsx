import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PLATFORM_COOKIE, authenticatePlatform } from "@/server/platform-service";
import FirmiClient from "./firme-client";

export const dynamic = "force-dynamic";

/**
 * Operator: lista firmi (spec 01 §4).
 *
 * Provjera je ovdje, na serveru: bez platform sesije se ne renderuje ni klijent. Ako
 * `DATABASE_ADMIN_URL` nije podešen, `authenticatePlatform` pada na grešku — zato se
 * greška hvata i pretvara u „niste prijavljeni“, a ne u pad stranice.
 */
export default async function FirmePage() {
  const token = (await cookies()).get(PLATFORM_COOKIE)?.value;
  if (!token) redirect("/login?platform=1");

  let principal = null;
  try {
    principal = await authenticatePlatform(token);
  } catch {
    principal = null;
  }
  if (!principal) redirect("/login?platform=1");

  return (
    <main className="mx-auto w-full max-w-5xl">
      <FirmiClient operatorEmail={principal.email} />
    </main>
  );
}
