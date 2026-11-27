import { Alert, Chip } from "@/components/ui/index";
import {
  usageBlockMessage,
  usageWarningMessage,
  type UsageDecision,
} from "@gradix/domain";

/**
 * Blokada ili upozorenje „smije li se ova radnja“ — ISTA poruka na svakom ekranu.
 *
 * Poruka dolazi iz `@gradix/domain` (`usageBlockMessage` / `usageWarningMessage`), a ne iz
 * ekrana. To je namjerno: do Faze 0 su dodjele, ture i sati mašine imali tri verzije istog
 * objašnjenja, pa je korisnik na dva ekrana dobijao dva različita teksta za isti problem.
 *
 * `decision` je odgovor SERVERA (`/api/me/blockers` ili polje u odgovoru mutacije). Komponenta
 * ne odlučuje — samo prikazuje. Blokada se ne može zaobići u UI-u jer je nema gdje zaobići.
 */
export function UsageWarning({
  decision,
  action,
}: {
  decision: UsageDecision | null | undefined;
  /** Za ekrane koji prikazuju više radnji (npr. dodjela + tura). */
  action?: string;
}) {
  if (!decision) return null;

  const block = usageBlockMessage(decision);
  if (block) {
    return (
      <Alert tone="error" role="alert">
        {block}
        {action ? ` (${action})` : ""}
      </Alert>
    );
  }

  const warn = usageWarningMessage(decision);
  if (!warn) return null;
  return (
    <Alert tone="warning" role="status">
      {warn}
    </Alert>
  );
}

/**
 * Kratka oznaka za listu (red u tabeli): „blokirano“ / „pažnja“.
 * Tekst, ne samo boja — ista pravila kao `Chip`.
 */
export function UsageBadge({ decision }: { decision: UsageDecision | null | undefined }) {
  if (!decision) return null;
  if (!decision.allowed) return <Chip tone="hollow">Blokirano</Chip>;
  if (decision.warns.length > 0) return <Chip tone="hot">Pažnja</Chip>;
  return null;
}
