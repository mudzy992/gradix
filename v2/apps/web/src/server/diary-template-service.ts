/**
 * F9 — šablon PDF-a dnevnika građenja (spec 10 §1.7/31-33).
 *
 * Zašto šablon živi u bazi, a ne u kodu: sadržaj i redoslijed sekcija se razlikuju od firme do
 * firme (i od opštine do opštine), a brief ga je ostavio OTVORENIM. Zato platforma daje
 * konfigurabilan šablon, a konačni tekst potvrđuje vlasnik/pravnik — do tada izvoz nosi
 * `DRAFT_FORMAT` i ne tvrdi da je zakonski obrazac.
 *
 * `format_confirmed_at` je JEDINI prekidač te tvrdnje. Ne `is_default`, ne `is_active`: šablon
 * može biti podrazumijevan i aktivan, a još nepotvrđen.
 */
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";

export type DiaryTemplateSection = {
  /** Ključ sekcije — PDF i ekran koriste isti redoslijed. */
  key: "HEADER" | "WEATHER" | "WORKERS" | "MACHINES" | "QUANTITIES" | "HAULS" | "EVENTS" | "DELAYS" | "ATTACHMENTS" | "SIGNATURES";
  label: string;
  enabled: boolean;
};

export type DiaryTemplate = {
  id: string;
  name: string;
  header: { companyLine: string | null; projectLine: string | null; legalNote: string | null };
  sections: DiaryTemplateSection[];
  isDefault: boolean;
  formatConfirmedAt: string | null;
  /** `true` dok vlasnik/pravnik nije potvrdio obrazac — PDF tada nosi `DRAFT_FORMAT`. */
  draftFormat: boolean;
};

/**
 * Početni šablon odgovara uobičajenoj praksi gradilišta (spec §1.7/31): projekt, vrijeme,
 * radnici, mašine, izvedeni radovi, događaji, zastoji, potpisi izvođača i nadzora.
 *
 * Redoslijed NIJE proizvoljan: on prati kako se dnevnik čita naglas na sastanku — prvo šta je
 * urađeno, pa koliko, pa šta je smetalo, pa ko potpisuje.
 */
export const DEFAULT_DIARY_SECTIONS: readonly DiaryTemplateSection[] = [
  { key: "HEADER", label: "Zaglavlje (firma, projekat, datum)", enabled: true },
  { key: "WEATHER", label: "Vremenski uslovi i radni sati", enabled: true },
  { key: "WORKERS", label: "Radnici i sati (iz radnih dana)", enabled: true },
  { key: "MACHINES", label: "Mašine i sati (iz sati mašina)", enabled: true },
  { key: "QUANTITIES", label: "Izvedeni radovi (količine)", enabled: true },
  { key: "HAULS", label: "Ture i količine", enabled: true },
  { key: "EVENTS", label: "Posebni događaji i posjetioci", enabled: true },
  { key: "DELAYS", label: "Zastoji (dokaz za produženje roka)", enabled: true },
  { key: "ATTACHMENTS", label: "Prilozi (fotografije, zapisnici)", enabled: true },
  { key: "SIGNATURES", label: "Potpisi izvođača i nadzora", enabled: true },
];

export const DRAFT_FORMAT_LABEL = "DRAFT_FORMAT — nacrt obrasca, nije potvrđen od vlasnika/pravnika";

/**
 * Pravi podrazumijevani šablon lenjo (kao `ensureChecklistTemplates` u F7 i
 * `ensureCostCategories` u F5): migracija ne može upisati `created_by` jer bi taj red držao
 * RESTRICT vezu ka `users` i blokirao brisanje korisnika u testovima.
 */
export async function ensureDefaultDiaryTemplate(client: PoolClient, companyId: string): Promise<string> {
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM public.site_diary_templates WHERE company_id = $1 AND is_default AND is_active LIMIT 1",
    [companyId],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const id = `sdt_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await client.query(
    `INSERT INTO public.site_diary_templates (id, company_id, name, header, sections, is_default, is_active)
     VALUES ($1, $2, 'Dnevnik građenja (početni)', $3::jsonb, $4::jsonb, true, true)
     ON CONFLICT DO NOTHING`,
    [
      id, companyId,
      JSON.stringify({ companyLine: null, projectLine: null, legalNote: null }),
      JSON.stringify(DEFAULT_DIARY_SECTIONS),
    ],
  );
  return id;
}

export async function listDiaryTemplates(client: PoolClient, companyId: string): Promise<DiaryTemplate[]> {
  await ensureDefaultDiaryTemplate(client, companyId);
  const result = await client.query<{
    id: string; name: string; header: DiaryTemplate["header"]; sections: DiaryTemplateSection[];
    is_default: boolean; format_confirmed_at: string | null;
  }>(
    `SELECT id, name, header, sections, is_default, format_confirmed_at::text
       FROM public.site_diary_templates
      WHERE company_id = $1 AND is_active
      ORDER BY is_default DESC, name`,
    [companyId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    header: row.header,
    sections: row.sections,
    isDefault: row.is_default,
    formatConfirmedAt: row.format_confirmed_at,
    draftFormat: row.format_confirmed_at === null,
  }));
}

/** Podrazumijevani šablon za PDF; ako ga nema, pravi se — izvoz nikad ne pada zbog šablona. */
export async function resolveDiaryTemplate(client: PoolClient, companyId: string): Promise<DiaryTemplate> {
  const templates = await listDiaryTemplates(client, companyId);
  const template = templates.find((item) => item.isDefault) ?? templates[0];
  if (template) return template;
  const id = await ensureDefaultDiaryTemplate(client, companyId);
  const created = await listDiaryTemplates(client, companyId);
  return created.find((item) => item.id === id) ?? created[0]!;
}
