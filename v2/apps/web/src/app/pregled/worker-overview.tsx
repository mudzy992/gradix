import Link from "next/link";
import { OBLIGATION_STATE_LABELS } from "@gradix/domain";
import { Card, Stat } from "@/components/ui/index";
import type { WorkerOverview } from "@/server/worker-overview";

export function WorkerOverviewPanel({ data }: { data: WorkerOverview }) {
  if (!data.linked) return <Card><h2 className="gx-section-title">Vaš radni pregled</h2>
    <p>{data.ambiguous ? "Vaš račun povezan je s više aktivnih radnika. Zamolite administratora da provjeri veze." : "Vaš korisnički račun još nije povezan s radnikom. Zamolite administratora da poveže vaš zapis."}</p>
    <Link href="/ured/profil">Provjerite svoj profil</Link>
  </Card>;
  const valid = data.obligations.filter(item => ["valid", "no_expiry", "expiring", "review_due"].includes(item.state)).length;
  const current = data.current;
  const status = !current ? "Nema unosa" : current.openSegments ? "U toku" : current.approvalStatus === "LOCKED" ? "Zaključan" : current.approvalStatus === "FOREMAN_CONFIRMED" ? "Potvrđen" : current.status === "SUBMITTED" ? "Predan" : "U pripremi";
  return <>
    <div className="gx-dashboard-kpis" aria-label="Moj pregled">
      <Stat label="Sati ovog mjeseca" value={`${Math.floor(data.minutes / 60)} h ${Number((data.minutes % 60).toFixed(2))} min`} hint="Zatvoreni, zaokruženi segmenti rada; bez pauza" />
      <Stat label="Današnji dan" value={status} hint={current?.reviewState === "FORGOTTEN" || current?.reviewState === "UNKNOWN_END" ? "Potrebna provjera" : undefined} />
      <Stat label="Važeće obaveze" value={data.obligations.length ? `${valid} / ${data.obligations.length}` : "Nema podataka"} hint="Evidentirani dokumenti; ne uključuje one koji čekaju provjeru" />
      <Stat label="Preostali godišnji" value={data.leaveBalance === null ? "Nije upisano" : `${data.leaveBalance} dana`} hint="Za tekuću godinu" />
    </div>
    <div className="gx-cols">
      <Card><h2 className="gx-section-title">Moj dan</h2>
        {data.dayCount === 0 ? <p>Još nema evidentiranih radnih dana ovog mjeseca. Radni dan možete započeti u mobilnoj aplikaciji.</p> :
          <p>{current ? `Današnji dan: ${status.toLowerCase()}.` : "Danas još nema unosa."} Za unos ili pregled rada koristite mobilnu aplikaciju.</p>}
        <Link href="/ured/profil">Moj profil i sigurnost</Link>{" · "}<Link href="/ured/obavjestenja">Obavještenja</Link>
      </Card>
      <Card><h2 className="gx-section-title">Moje obaveze</h2>
        {data.obligations.length ? <ul className="gx-stack gx-stack--2">{data.obligations.map((item, index) =>
          <li key={`${item.label}-${index}`}><strong>{item.label}</strong> · {OBLIGATION_STATE_LABELS[item.state]}{item.expiresAt ? ` · do ${item.expiresAt}` : ""}</li>)}</ul> :
          <p>Za vas još nema evidentiranih obaveza ili ljekarskih pregleda. Za upis se obratite uredu.</p>}
        {data.leaveBalance === null ? <p>Pravo na godišnji za ovu godinu još nije upisano; obratite se uredu.</p> : null}
      </Card>
    </div>
  </>;
}
