"use client";
import Link from "next/link";
import { useRef } from "react";
import { Badge, Icon } from "./ui";
import type { NavModule } from "./nav";

/** Najduža dozvoljena putanja pobjeđuje; detalji ostaju u istom modulu. */
export function activeModule(modules: readonly NavModule[], pathname: string): {module: NavModule; href: string} | null {
  let result: {module: NavModule; href: string} | null = null;
  for (const module of modules) for (const item of module.items) {
    if ((pathname === item.href || pathname.startsWith(`${item.href}/`)) && (!result || item.href.length > result.href.length)) {
      result={module,href:item.href};
    }
  }
  if (!result && (pathname === "/ured/akcije" || pathname.startsWith("/ured/akcije/"))) {
    const module = modules.find(candidate => candidate.items.some(item => item.href === "/pregled"));
    if (module) return {module, href:"/pregled"};
  }
  return result;
}

export function ModuleNavigation({modules,pathname,onNavigate}: {modules: NavModule[]; pathname:string; onNavigate?: () => void}) {
  const active=activeModule(modules,pathname);
  const navRef = useRef<HTMLElement>(null);
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const links = Array.from(navRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-nav-item]") ?? []);
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (index < 0) return;
    let next: number;
    if (event.key === "ArrowDown") next = Math.min(index + 1, links.length - 1);
    else if (event.key === "ArrowUp") next = Math.max(index - 1, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = links.length - 1;
    else return;
    event.preventDefault();
    links[next]?.focus();
  }
  return <nav ref={navRef} onKeyDown={onKeyDown} className="gx-nav gx-scroll-hidden" aria-label="Glavna navigacija">
    {modules.map(module=>{
      const first=module.items[0]!;
      const badge=module.items.find(item=>item.badge && item.badge.count>0)?.badge;
      return <Link key={module.label} href={first.href} onClick={onNavigate} data-nav-item data-label={module.label}
        aria-current={active?.module.label === module.label ? "location" : undefined} className="gx-nav-item">
        <span className="gx-nav-item__icon"><Icon name={module.icon} /></span><span>{module.label}</span>
        {badge ? <Badge tone={badge.older>0 ? "danger" : "primary"}>{badge.count}</Badge> : null}
      </Link>;
    })}
  </nav>;
}

export function ModuleTabs({modules,pathname}: {modules: NavModule[]; pathname:string}) {
  const active=activeModule(modules,pathname);
  if (!active || active.module.items.length < 2) return null;
  return <nav aria-label={`${active.module.label} — navigacija`} className="gx-tabs gx-module-tabs">
    {active.module.items.map(item=><Link key={item.href} href={item.href}
      className={`gx-tab${item.href === active.href ? " gx-tab--active" : ""}`}
      aria-current={item.href === active.href ? "page" : undefined}>
      {item.label}{item.badge && item.badge.count>0 ? ` (${item.badge.count})` : ""}
    </Link>)}
  </nav>;
}
