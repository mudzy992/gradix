/**
 * GET /api/users — lista osoba u firmi. Traži `users.manage` (OWNER/ADMIN).
 * Vraća samo polja koja ekran koristi; nema password_hash ni tokena.
 */
import type { NextRequest } from "next/server";
import { internal, ok } from "@/server/api";
import { listUsers } from "@/server/access-service";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "users.manage");
    if (!guardResult.ok) return guardResult.response;
    const users = await listUsers(await getVerifiedPool(), guardResult.ctx.companyId);
    return ok({ users });
  } catch (error) {
    return internal(error, "users.list");
  }
}
