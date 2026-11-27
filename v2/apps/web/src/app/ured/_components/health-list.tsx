import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import type { HealthKey } from "@/server/data-health-queries";
import { DATA_HEALTH_HREFS } from "@/server/data-health";

type Key = Exclude<HealthKey,"unconfirmed_days">;
const titles: Record<Key,string> = {
  projects_without_budget:"Projekti bez budžeta", machines_without_rate:"Mašine bez stope",
  workers_without_rate:"Radnici bez satnice", warehouses_without_minimum:"Skladišta bez minimuma",
  incidents_without_actions:"Incidenti bez mjera",
};
const target: Record<Key,(id:string)=>string> = {
  projects_without_budget:id=>`/ured/projekti/${encodeURIComponent(id)}`,
  machines_without_rate:id=>`/ured/trosak-masina?masina=${encodeURIComponent(id)}`,
  workers_without_rate:id=>`/ured/radnici/${encodeURIComponent(id)}`,
  warehouses_without_minimum:id=>`/ured/skladiste?warehouse=${encodeURIComponent(id)}`,
  incidents_without_actions:id=>`/ured/hse/${encodeURIComponent(id)}`,
};
export function HealthList({healthKey,rows,page,hasMore}:{healthKey:Key;rows:{id:string;label:string}[];page:number;hasMore:boolean}) {
  const base=DATA_HEALTH_HREFS[healthKey];
  const all=base.split("?")[0]!;
  return <main className="mx-auto w-full max-w-6xl">
    <PageHeader title={titles[healthKey]} subtitle="Prikazani su samo zapisi s ovim nedostatkom, u vašem opsegu." />
    <p><Link className="gx-link" href={all}>Prikaži sve</Link></p>
    <Card>
      {!rows.length ? <p>Nema zapisa koji odgovaraju filteru.</p> : <ul className="gx-stack gx-stack--2">
        {rows.map(row=><li key={row.id}><Link className="gx-link" href={target[healthKey](row.id)}>{row.label}</Link></li>)}
      </ul>}
      <nav aria-label="Stranice rezultata" className="gx-inline-flex">
        {page>1 ? <Link href={`${base}&page=${page-1}`}>Prethodna</Link> : null}
        <span>Stranica {page}</span>
        {hasMore ? <Link href={`${base}&page=${page+1}`}>Sljedeća</Link> : null}
      </nav>
    </Card>
  </main>;
}
