import Link from "next/link";
import type { ActionList } from "@/server/dashboard-action-lists";
import { PageHeader } from "@/components/ui";

export function ActionListView({list,actionKey}:{list:ActionList;actionKey:string}) {
  const pageHref=(page:number)=>`/ured/akcije?${new URLSearchParams({key:actionKey,page:String(page)})}`;
  return <main className="mx-auto w-full max-w-6xl">
    <PageHeader title={list.title} subtitle="Filtrirani zapisi u vašem dostupnom opsegu. Otvorite zapis ili njegov modul za radnju." />
    <p><Link href="/pregled">← Nazad na pregled</Link></p>
    {list.items.length ? <ul className="gx-stack gx-stack--2">{list.items.map(item=><li key={item.id}>
      <Link href={item.href}>{item.label}</Link> <span className="gx-page-sub">· {item.id}</span>
    </li>)}</ul> : <p>Nema zapisa za ovaj filter.</p>}
    <nav aria-label="Stranice akcione liste">
      {list.page>1 ? <Link href={pageHref(list.page-1)}>Prethodna stranica</Link> : null}{" "}
      <span>Stranica {list.page}</span>{" "}
      {list.hasNext ? <Link href={pageHref(list.page+1)}>Sljedeća stranica</Link> : null}
    </nav>
  </main>;
}
