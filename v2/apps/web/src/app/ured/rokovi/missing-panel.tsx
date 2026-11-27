"use client";

/**
 * F2 — kartica „Nedostaje“ na ekranu rokova.
 *
 * Šta ova kartica rješava: ured u pilotu ne zna šta NIJE uneseno — lista rokova prikazuje samo
 * ono što postoji. Ovaj panel pokazuje obaveze koje po pravilima firme treba da postoje, a ne
 * postoje, i nudi dvije radnje: „Kreiraj sve nedostajuće“ (jedan datum provjere za sve) i
 * prelazak na pravila.
 *
 * Tri pravila koja panel poštuje:
 *  1. **Ništa se ne kreira bez datuma provjere.** Nove obaveze nemaju rok, pa im je datum
 *     provjere jedini rok koji imaju — dugme je onemogućeno dok datum nije unesen.
 *  2. **Nedostatak nije greška.** Panel je informacija i nikad ne blokira rad; tekst to kaže,
 *     jer korisnik koji misli da je nešto pokvareno zove podršku.
 *  3. **Grupisanje po tipu.** „Ljekarski — 7 radnika“ je jedna odluka, ne sedam.
 */
import { useCallback, useEffect, useState } from "react";
import type { MissingObligation as MissingObligationSchema } from "@gradix/contracts";
import { apiCall } from "@/api-client";
import { Alert, Button, Card, EmptyState, Input, SectionTitle, Skeleton } from "@/components/ui/index";

type MissingResponse = {
  items: Array<MissingObligationSchema & { typeLabel: string; entityName: string }>;
  groups: { typeId: string; entityKind: string; count: number; ids: string[] }[];
  counts: { total: number; workers: number; machines: number; projects: number };
  today: string;
};

export default function MissingPanel({
  canManage,
  onCreated,
}: {
  canManage: boolean;
  /** Poziva se poslije uspješnog kreiranja — lista rokova se tada ponovo učita. */
  onCreated: () => void;
}) {
  const [data, setData] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; value: MissingResponse }>({
    kind: "loading",
  });
  const [reviewAt, setReviewAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const result = await apiCall<MissingResponse>("/api/obligations/missing");
    if (!result.ok) {
      setData({ kind: "error", message: result.message });
      return;
    }
    setData({ kind: "ready", value: result.data });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createAll = async () => {
    setBusy(true);
    setMessage(null);
    const result = await apiCall<{ created: number; skipped: unknown[] }>("/api/obligations/missing/create", {
      method: "POST",
      body: JSON.stringify({ reviewAt }),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.message });
      return;
    }
    // Preskočeni redovi se PRIJAVLJUJU: korisnik mora znati da nije sve prošlo, a ne da
    // otkrije to sutra na listi.
    const skipped = Array.isArray(result.data.skipped) ? result.data.skipped.length : 0;
    setMessage({
      tone: skipped > 0 ? "error" : "success",
      text:
        skipped > 0
          ? `Kreirano ${result.data.created}, preskočeno ${skipped}. Provjerite listu.`
          : `Kreirano ${result.data.created} ${result.data.created === 1 ? "obaveza" : "obaveza"}.`,
    });
    await load();
    onCreated();
  };

  if (data.kind === "loading") return <Skeleton rows={3} />;
  if (data.kind === "error") {
    return <Alert tone="error">Nedostajuće obaveze se ne mogu učitati: {data.message}</Alert>;
  }

  const { value } = data;
  if (value.counts.total === 0) {
    return (
      <Card>
        <SectionTitle>Nedostaje</SectionTitle>
        <EmptyState
          title="Sve obaveze su unesene"
          description="Po pravilima firme, nijedan aktivan radnik, mašina ni projekat ne čeka dokument."
        />
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle hint="Po pravilima firme — ovo nije greška, nego posao za ured">Nedostaje</SectionTitle>
      <p className="text-sm text-muted-foreground">
        {value.counts.total} obaveza još nije uneseno — radnika {value.counts.workers}, mašina{" "}
        {value.counts.machines}, projekata {value.counts.projects}.
      </p>
      <div className="flex flex-col gap-4">
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

        <ul className="flex flex-col gap-2">
          {value.groups.slice(0, 8).map((group) => (
            <li key={`${group.entityKind}:${group.typeId}`} className="flex items-center justify-between gap-3">
              <span>
                {value.items.find((item) => item.typeId === group.typeId)?.typeLabel ?? group.typeId}
                <span className="text-muted-foreground"> · {group.entityKind === "WORKER" ? "radnici" : group.entityKind === "MACHINE" ? "mašine" : "projekti"}</span>
              </span>
              <span className="font-medium">{group.count}</span>
            </li>
          ))}
        </ul>

        {canManage ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Provjeri do</span>
              <Input
                type="date"
                value={reviewAt}
                onChange={(event) => setReviewAt(event.target.value)}
                // Datum provjere je jedini rok koji nove obaveze imaju.
                aria-describedby="missing-review-help"
              />
            </label>
            <Button
              onClick={() => void createAll()}
              disabled={busy || reviewAt === ""}
              aria-describedby="missing-review-help"
            >
              {busy ? "Kreiram…" : "Kreiraj sve nedostajuće"}
            </Button>
            <p id="missing-review-help" className="text-sm text-muted-foreground">
              Kreira obaveze bez roka, sa datumom do kojeg ih ured provjerava. Broj i datum
              dokumenta se unose kasnije.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nedostajuće obaveze kreira ured. Ovo je prikaz, ne blokada rada.
          </p>
        )}
      </div>
    </Card>
  );
}
