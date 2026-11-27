import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { notFound } from "next/navigation";
import { withCompany } from "@gradix/db";
import { ComponentCatalog } from "@/components/ui/catalog";
import { authenticate } from "@/server/tenant-context";
import { ACCESS_COOKIE } from "@/server/session";
import { getVerifiedPool } from "@/server/db";
import { catalogAllowed } from "@/server/catalog-access";

export const dynamic = "force-dynamic";

/**
 * U5 katalog — razvojni alat, namjerno izvan navigacije (izuzetak u nav.test.ts).
 * Nije javno (Dio 2): produkcija = samo platformski administrator (env), ostalima 404.
 */
export default async function CatalogPage() {
  if (process.env.NODE_ENV === "production") {
    let email: string | null = null;
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (token) {
      const request = new NextRequest("http://interni/katalog", {
        headers: { cookie: `${ACCESS_COOKIE}=${token}` },
      });
      const auth = await authenticate(request);
      if (auth.ok) {
        email = await withCompany(await getVerifiedPool(), auth.ctx.companyId, async (client) => {
          const result = await client.query<{ email: string }>(
            "SELECT email FROM users WHERE id = $1",
            [auth.ctx.userId],
          );
          return result.rows[0]?.email ?? null;
        });
      }
    }
    if (!catalogAllowed({ nodeEnv: process.env.NODE_ENV, email, adminEmailsRaw: process.env.PLATFORM_ADMIN_EMAILS })) {
      notFound();
    }
  }
  return <ComponentCatalog />;
}
