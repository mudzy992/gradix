import { redirect } from "next/navigation";

/**
 * Platforma koristi ISTI ekran za prijavu (jedan obrazac, jedan `POST`), ali šalje na
 * `/api/platform/login`. Zaseban fajl postoji da URL bude jasan operatoru.
 */
export default function PlatformLoginPage() {
  redirect("/login?platform=1");
}
