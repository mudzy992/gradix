import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PLATFORM_COOKIE, authenticatePlatform } from "@/server/platform-service";
import OnboardingClient from "./onboarding-client";

export const dynamic = "force-dynamic";

/** Onboarding čarobnjak (spec 01 §4.2) — firma + vlasnik u jednoj transakciji. */
export default async function NovaFirmaPage() {
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
    <main className="mx-auto w-full max-w-3xl">
      <OnboardingClient />
    </main>
  );
}
