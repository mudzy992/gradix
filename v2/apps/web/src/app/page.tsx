import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, verifyAccessToken } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  redirect(token && verifyAccessToken(token) ? "/pregled" : "/login");
}
