import Link from "next/link";
import type { PregledResponse } from "@gradix/contracts";
import { Card, Chip, EmptyState, Icon, PageHeader, TextLink, type IconName } from "@/components/ui/index";
import { formatDate, formatDayTime, formatLongDate } from "@/format";

/**
 * C.1 pregled — prikaz odobrenog dizajna (docs/design/reference.html #c1-pregled-reference).
 *
 * Ovo je SAMO prikaz: redoslijed, tonovi, nazivi i linkovi; svi brojevi dolaze iz
 * `PregledResponse` (servis računa isto stanje koje gledaju liste na koje redovi vode).
 * Bez vlastitog stanja i bez upita — zato se može testirati bez baze.
 *
 * Redoslijed je hitnost, ne kategorija: isteklo prije „uskoro“, blokada dodjele prije
 * plana obnove. Svaki red je jedna veza na ekran na kojem se ta stvar rješava.
 */

type AttentionKey =
  | "expired"
  | "conflicts"
  | "expiring30"
  | "reviewDays"
  | "blockedAssignments"
  | "expiring3190";

type RowTone = "danger" | "warn" | "neutral";

/** Bosanski broj bez glavobolje: 1 stvar, 2 stvari, 5 stvari. */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** „za 7 dana“ / „istječe danas“ — rok u riječima, bez računanja u glavi. */
function inWords(days: number): string {
  if (days === 0) return "istječe danas";
  if (days === 1) return "za 1 dan";
  return `za ${days} dana`;
}

const daysBetween = (fromIso: string, toIso: string): number =>
  Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);

type RowSpec = {
  key: AttentionKey;
  tone: RowTone;
  icon: IconName;
  label: string;
  href: string;
  count: (data: PregledResponse) => number;
  /** Značka uz naslov — samo kad postoji razlog za isticanje (sukobi stariji od praga). */
  flag: (data: PregledResponse) => string | null;
  /** „Zašto ovaj red postoji“ — najstariji/najbliži primjeri. */
  hint: (data: PregledResponse) => string | null;
};

/** Redoslijed po hitnosti (odobreni dizajn): opasno → upozorenje → plan. */
const ROWS: readonly RowSpec[] = [
  {
    key: "expired",
    tone: "danger",
    icon: "warn",
    label: "Istekli rokovi",
    href: "/ured/rokovi?stanje=isteklo",
    count: (data) => data.attention.expired.count,
    flag: () => null,
    hint: (data) =>
      data.attention.expired.oldest.length > 0
        ? data.attention.expired.oldest
            .map((item) => `${item.typeLabel} ${item.target} (${formatDate(item.expiresAt)})`)
            .join(" · ")
        : null,
  },
  {
    key: "conflicts",
    tone: "danger",
    icon: "users",
    label: "Nerazriješeni sukobi",
    href: "/ured/sukobi?stanje=OPEN",
    count: (data) => data.attention.conflicts.count,
    flag: (data) => {
      const { olderThanThreshold, thresholdDays } = data.attention.conflicts;
      if (olderThanThreshold <= 0) return null;
      return `${olderThanThreshold} ${plural(olderThanThreshold, "stariji", "starija", "starijih")} od praga firme (${thresholdDays} ${plural(thresholdDays, "dan", "dana", "dana")})`;
    },
    hint: (data) =>
      data.attention.conflicts.oldest.length > 0
        ? data.attention.conflicts.oldest
            .map((item) => `${item.workerName} (${formatDate(item.createdAt)})`)
            .join(" · ")
        : null,
  },
  {
    key: "expiring30",
    tone: "warn",
    icon: "calendar",
    label: "Rokovi koji ističu u 30 dana",
    href: "/ured/rokovi?stanje=uskoro",
    count: (data) => data.attention.expiring30.count,
    flag: () => null,
    hint: (data) => {
      const nearest = data.attention.expiring30.nearest;
      if (!nearest) return null;
      return `Najbliži rok: ${nearest.typeLabel} ${nearest.target} — ${inWords(daysBetween(data.today, nearest.expiresAt))}`;
    },
  },
  {
    key: "reviewDays",
    tone: "warn",
    icon: "info",
    label: "Dani za provjeru",
    href: "/ured/radni-dani?filter=za-provjeru",
    count: (data) => data.attention.reviewDays.count,
    flag: () => null,
    hint: (data) =>
      data.attention.reviewDays.oldest.length > 0
        ? data.attention.reviewDays.oldest
            .map((item) =>
              `${item.workerName} — ${item.kind === "open" ? "otvoren segment" : "kraj nepoznat"} (${formatDate(item.workDate)})`,
            )
            .join(" · ")
        : null,
  },
  {
    key: "blockedAssignments",
    tone: "danger",
    icon: "shield",
    label: "Istekli rokovi blokiraju dodjelu",
    href: "/ured/projekti",
    count: (data) => data.attention.blockedAssignments.count,
    flag: () => null,
    hint: (data) =>
      data.attention.blockedAssignments.examples.length > 0
        ? data.attention.blockedAssignments.examples
            .map((item) => `${item.target} (${item.typeLabel})`)
            .join(" · ")
        : null,
  },
  {
    key: "expiring3190",
    tone: "neutral",
    icon: "list",
    label: "Rokovi 31–90 dana",
    href: "/ured/rokovi?stanje=31-90",
    count: (data) => data.attention.expiring3190.count,
    flag: () => null,
    hint: (data) => {
      const nearest = data.attention.expiring3190.nearest;
      if (!nearest) return null;
      return `Još ne pregrijavaju — tu su za plan obnove. Najbliži: ${nearest.typeLabel} ${nearest.target} (${formatDate(nearest.expiresAt)}).`;
    },
  },
];

/** Redovi koji „traže pažnju“ — 31–90 dana je plan, ne uzbuna. */
const URGENT_KEYS: readonly AttentionKey[] = [
  "expired",
  "conflicts",
  "expiring30",
  "reviewDays",
  "blockedAssignments",
];

export function PregledBoard({
  data,
  firstName,
  greeting,
}: {
  data: PregledResponse;
  firstName: string | null;
  /** „Dobro jutro“ / „Dobar dan“ / „Dobro veče“ — računa stranica, u zoni firme. */
  greeting: string;
}) {
  const visible = ROWS.filter((row) => row.count(data) > 0);
  const urgent = URGENT_KEYS.reduce((sum, key) => sum + (ROWS.find((row) => row.key === key)!.count(data)), 0);

  const subtitle = (() => {
    const datePart = formatLongDate(data.today);
    if (urgent === 0) return `${datePart} · Ništa ne traži pažnju.`;
    return `${datePart} · ${urgent} ${plural(urgent, "stvar", "stvari", "stvari")} ${plural(urgent, "traži", "traže", "traži")} vašu pažnju.`;
  })();

  return (
    <div>
      <PageHeader
        title={firstName ? `${greeting}, ${firstName}` : "Pregled"}
        subtitle={subtitle}
      />

      <Card>
        <div className="gx-section-head">
          <div className="gx-section-head__text">
            <h2 className="gx-section-title">Šta traži pažnju</h2>
            <span className="gx-section-hint">
              {data.scope === "projects" ? "samo vaš opseg" : "najvažnije prvo; svaki red vodi na mjesto rješavanja"}
            </span>
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            title="Ništa ne traži pažnju"
            description="To je dobra vijest: nema isteklih rokova, nerazriješenih sukoba ni dana za provjeru."
            action={<TextLink href="/ured/rokovi">Svejedno pogledaj rokove</TextLink>}
          />
        ) : (
          <ul className="gx-attention-list">
            {visible.map((row) => {
              const flag = row.flag(data);
              const hint = row.hint(data);
              return (
                <li key={row.key} className="gx-attention-item">
                  <Link href={row.href} className="gx-attention-row" data-tone={row.tone}>
                    <span className="gx-attention-ico">
                      <Icon name={row.icon} />
                    </span>
                    <span>
                      <span className="gx-attention-title">
                        {row.label}
                        {flag ? <span className="gx-attention-flag">{flag}</span> : null}
                      </span>
                      {hint ? <span className="gx-attention-hint">{hint}</span> : null}
                    </span>
                    <span className="gx-attention-count">{row.count(data)}</span>
                    <span className="gx-attention-go" aria-hidden="true">
                      Otvori →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <div className="gx-section-head">
          <div className="gx-section-head__text">
            <h2 className="gx-section-title">Sažetak</h2>
            <span className="gx-section-hint">
              {data.scope === "projects" ? "svijet u vašem opsegu" : "stanje firme na prvi pogled"}
            </span>
          </div>
        </div>
        <ul className="gx-summary-list">
          <li>
            <span className="gx-summary-value gx-mono">{data.summary.activeProjects}</span>
            <span className="gx-summary-label">aktivni projekti</span>
          </li>
          <li>
            <span className="gx-summary-value gx-mono">{data.summary.activeWorkers}</span>
            <span className="gx-summary-label">aktivni radnici</span>
          </li>
          <li>
            <span className="gx-summary-value gx-mono">{data.summary.activeMachines}</span>
            <span className="gx-summary-label">mašine</span>
          </li>
          <li>
            <span className="gx-summary-value gx-mono">{data.summary.entriesThisWeek}</span>
            <span className="gx-summary-label">unosi rada ovaj tjedan</span>
          </li>
        </ul>
      </Card>

      {data.sync !== null ? (
        <Card>
          <div className="gx-section-head">
            <div className="gx-section-head__text">
              <h2 className="gx-section-title">Stanje sinhronizacije</h2>
              <span className="gx-section-hint">zadnja veza po osobi; neuspješne stavke čekaju razrješenje</span>
            </div>
            <Link className="gx-btn gx-btn--quiet" href="/ured/audit">
              Audit trag
            </Link>
          </div>
          {data.sync.length === 0 ? (
            <p className="gx-page-sub">Još nema primljenih sinhronizacija sa telefona.</p>
          ) : (
            <ul className="gx-sync-list">
              {data.sync.map((row) => (
                <li key={row.userId} className="gx-sync-row">
                  <div>
                    <b>{row.name}</b>
                    <small>zadnja sinhronizacija {formatDayTime(row.lastSyncAt, data.timezone)}</small>
                  </div>
                  {row.failedItems > 0 ? (
                    <Chip tone="hot">
                      {row.failedItems} {plural(row.failedItems, "neuspješna stavka", "neuspješne stavke", "neuspješnih stavki")}
                    </Chip>
                  ) : (
                    <Chip tone="hollow">sve prošlo</Chip>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
