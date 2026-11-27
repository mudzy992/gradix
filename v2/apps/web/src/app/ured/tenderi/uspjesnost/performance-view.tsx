"use client";

import { DataTable, Mono, Stat } from "@/components/ui/index";

export type PerformanceView = {
  totalCount: number;
  wonCount: number;
  lostCount: number;
  winRateByCount: string | null;
  wonValueAmount: string;
  totalValueAmount: string;
  winRateByValue: string | null;
  avgMarginWonPct: string | null;
  avgMarginLostPct: string | null;
  currencyCode: string;
  inProgressValueAmount: string;
  inProgressCount: number;
  byPartner: Array<{
    partnerId: string;
    partnerName: string;
    totalCount: number;
    wonCount: number;
    wonValueAmount: string;
  }>;
};

/**
 * Prikaz uspješnosti (klijentski) — serverska stranica donosi samo podatke.
 *
 * Zašto odvojeno: `DataTable` prima `cell` funkcije, a serverska komponenta ih ne može
 * proslijediti bez pada u runtime-u (klasa buga „funkcija iz serverske u klijentsku“). Ovaj
 * fajl je jedino mjesto gdje te funkcije smiju živjeti.
 */
export function PerformanceView({ p }: { p: PerformanceView }) {
  const pct = (value: string | null) => (value === null ? "—" : `${value} %`);

  return (
    <>
      <div className="gx-cols">
        <Stat
          label="Odluka (dobijeno/izgubljeno)"
          value={String(p.totalCount)}
          hint={`${p.wonCount} dobijeno · ${p.lostCount} izgubljeno`}
        />
        <Stat label="Win rate (broj)" value={pct(p.winRateByCount)} />
        <Stat label="Win rate (vrijednost)" value={pct(p.winRateByValue)} />
        <Stat
          label="Vrijednost u toku"
          value={`${p.inProgressValueAmount} ${p.currencyCode}`}
          hint={`${p.inProgressCount} otvorenih tendera`}
        />
      </div>

      <div className="gx-cols">
        <Stat
          label="Dobijena vrijednost"
          value={`${p.wonValueAmount} ${p.currencyCode}`}
          hint={`od ${p.totalValueAmount} ${p.currencyCode} odlučenih`}
        />
        <Stat label="Prosječna marža — dobijeni" value={pct(p.avgMarginWonPct)} />
        <Stat label="Prosječna marža — izgubljeni" value={pct(p.avgMarginLostPct)} />
      </div>

      <section className="gx-card">
        <h2 className="gx-section-title">Po naručiocu</h2>
        <DataTable
          caption="Uspješnost po naručiocu"
          rowKey={(row) => row.partnerId}
          rows={p.byPartner}
          emptyText="Nema odlučenih tendera."
          columns={[
            { key: "name", header: "Naručilac", cell: (row) => row.partnerName },
            { key: "total", header: "Odluka", numeric: true, cell: (row) => String(row.totalCount) },
            { key: "won", header: "Dobijeno", numeric: true, cell: (row) => String(row.wonCount) },
            {
              key: "value",
              header: "Dobijena vrijednost",
              numeric: true,
              cell: (row) => <Mono>{`${row.wonValueAmount} ${p.currencyCode}`}</Mono>,
            },
          ]}
        />
      </section>
    </>
  );
}
