import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { withCompany } from "@gradix/db";
import { authenticate } from "@/server/tenant-context";
import { getVerifiedPool } from "@/server/db";
import { ACCESS_COOKIE } from "@/server/session";
import { reviewLabel } from "./review-label";
import { can } from "@/server/permissions";

export const dynamic = "force-dynamic";

/**
 * Uredski pregled radnih dana (UI Step 7) — samo čitanje.
 *
 * Oznake za provjeru se računaju iz serverovog stanja, ne iz klijenta: nepoznat kraj,
 * otvoren segment, sukob u sync-u. Potvrđivanje/razrješenje nije dio ovog koraka (R4b).
 */
type DayRow = {
  id: string;
  work_date: string;
  status: string;
  worker_name: string;
  entries: number;
  unknown_end: number;
  open_entries: number;
  project_codes: string | null;
};

export default async function RadniDaniPage() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");

  const request = new NextRequest("http://interni/ured/radni-dani", {
    headers: { cookie: `${ACCESS_COOKIE}=${token}` },
  });
  const auth = await authenticate(request);
  if (!auth.ok) redirect("/login");
  if (auth.ctx.mustChangePassword) redirect("/lozinka/promjena");
  if (!can(auth.ctx.roles, "workdays.view")) redirect("/pregled");

  const days = await withCompany(await getVerifiedPool(), auth.ctx.companyId, async (client) => {
    const result = await client.query<DayRow>(
      `SELECT d.id,
              d.work_date::text AS work_date,
              d.status,
              (w.first_name || ' ' || w.last_name) AS worker_name,
              count(e.id)::int AS entries,
              count(e.id) FILTER (WHERE e.end_state = 'UNKNOWN_END')::int AS unknown_end,
              count(e.id) FILTER (WHERE e.ended_at IS NULL AND e.end_state = 'OPEN')::int AS open_entries,
              string_agg(DISTINCT p.code, ', ') AS project_codes
         FROM public.workdays d
         JOIN public.workers w ON w.company_id = d.company_id AND w.id = d.worker_id
         LEFT JOIN public.work_entries e ON e.company_id = d.company_id AND e.workday_id = d.id
         LEFT JOIN public.projects p ON p.company_id = d.company_id AND p.id = e.project_id
        GROUP BY d.id, d.work_date, d.status, w.first_name, w.last_name
        ORDER BY d.work_date DESC, worker_name
        LIMIT 200`,
    );
    return result.rows;
  });

  return (
    <main className="mx-auto w-full max-w-6xl">
      <h1 className="text-2xl font-bold">Radni dani</h1>
      <p className="mt-1 text-sm opacity-70">
        Pregled dana pristiglih sa terena. Samo čitanje — potvrda i razrješenje nisu dio ovog koraka.
      </p>
      {days.length === 0 ? (
        <p className="mt-6">Još nema pristiglih radnih dana.</p>
      ) : (
        <table className="mt-6 w-full" aria-label="Radni dani">
          <thead>
            <tr>
              <th className="text-left">Radnik · datum</th>
              <th className="text-left">Projekti</th>
              <th className="text-left">Unosi</th>
              <th className="text-left">Stanje</th>
              <th className="text-left">Oznaka</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const label = reviewLabel(day);
              return (
                <tr key={day.id}>
                  <td data-label="Radnik · datum">
                    <strong>{day.worker_name}</strong>
                    <br />
                    {day.work_date}
                  </td>
                  <td data-label="Projekti">{day.project_codes ?? "—"}</td>
                  <td data-label="Unosi">{day.entries}</td>
                  <td data-label="Stanje">{day.status === "SUBMITTED" ? "Poslano" : "Nacrt"}</td>
                  <td data-label="Oznaka">{label ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
