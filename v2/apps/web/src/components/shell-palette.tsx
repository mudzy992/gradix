"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SearchResponse } from "@gradix/contracts";
import { apiCall } from "@/api-client";
import { Icon } from "./ui/index";
import type { NavItem } from "./shell-types";

type Hit = typeof SearchResponse._output["results"][number];
const labels: Record<Hit["type"],string> = { PROJECT:"Projekti", WORKER:"Radnici", MACHINE:"Mašine", PARTNER:"Partneri",
  TENDER:"Tenderi", DOCUMENT:"Dokumenti", INVOICE:"Računi", TASK:"Zadaci", OBLIGATION:"Rokovi",
  SERVICE_ORDER:"Servisni nalozi", INCIDENT:"Incidenti" };

export function CommandPalette({items,onClose,onNavigate}: {items:NavItem[];onClose:()=>void;onNavigate:(href:string)=>void}) {
  const [query,setQuery]=useState("");
  const [index,setIndex]=useState(0);
  const [hits,setHits]=useState<Hit[]>([]);
  const [state,setState]=useState<"idle"|"loading"|"done"|"error">("idle");
  const input=useRef<HTMLInputElement>(null);
  const closeButton=useRef<HTMLButtonElement>(null);
  const listId=useId();
  const results=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    const pages=items.filter(item=>!needle || item.label.toLowerCase().includes(needle) ||
      (item.description ?? "").toLowerCase().includes(needle))
      .map(item=>({group:"Stranice",href:item.href,label:item.label,icon:item.icon}));
    const matches=hits.filter(hit=>hit.href.startsWith("/") && !hit.href.startsWith("//"))
      .map(hit=>({group:labels[hit.type],href:hit.href,label:hit.title,icon:"search" as const}));
    return [...pages,...matches];
  },[items,query,hits]);
  const groups=useMemo(()=>[...new Set(results.map(result=>result.group))], [results]);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement | null;
    input.current?.focus();
    return ()=>previous?.focus?.();
  },[]);
  useEffect(()=>{
    const q=query.trim(); const controller=new AbortController(); let alive=true;
    setHits([]); setIndex(0);
    if (q.length < 2) { setState("idle"); return ()=>{alive=false;controller.abort();}; }
    setState("loading");
    const timer=setTimeout(()=>{
      void apiCall<typeof SearchResponse._output>(`/api/search?q=${encodeURIComponent(q)}`,{signal:controller.signal}).then(result=>{
        if (!alive) return;
        if (result.ok) {setHits(result.data.results);setState("done");}
        else setState("error");
      });
    },250);
    return ()=>{alive=false;controller.abort();clearTimeout(timer);};
  },[query]);
  function onKeyDown(event:React.KeyboardEvent) {
    if (event.key === "Escape") {event.stopPropagation();onClose();return;}
    if (event.key === "Tab") {
      event.preventDefault();
      (document.activeElement === input.current ? closeButton.current : input.current)?.focus();
      return;
    }
    if (event.target !== input.current) return;
    if (event.key === "ArrowDown") {event.preventDefault();setIndex(value=>Math.min(value+1,Math.max(results.length-1,0)));}
    if (event.key === "ArrowUp") {event.preventDefault();setIndex(value=>Math.max(value-1,0));}
    if (event.key === "Enter") {event.preventDefault();const target=results[index];if (target) onNavigate(target.href);}
  }
  return <div className="gx-overlay" role="presentation" onMouseDown={onClose}>
    <div role="dialog" aria-modal="true" aria-label="Brza navigacija" className="gx-dialog"
      style={{maxWidth:560,padding:0}} onMouseDown={event=>event.stopPropagation()} onKeyDown={onKeyDown}>
      <div style={{padding:10,borderBottom:"1px solid var(--line)",display:"flex",gap:8}}>
        <input ref={input} className="gx-input" role="combobox" aria-expanded="true" aria-controls={listId}
          aria-activedescendant={results[index] ? `${listId}-${index}` : undefined} aria-label="Traži stranicu ili podatak"
          placeholder="Traži projekte, radnike, mašine…" value={query} maxLength={100} onChange={event=>setQuery(event.target.value)} />
        <button ref={closeButton} type="button" className="gx-icon-btn" aria-label="Zatvori pretragu" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div role="status" aria-live="polite" className="gx-page-sub" style={{padding:"0 14px"}}>
        {state === "loading" ? "Pretraživanje…" : state === "error" ? "Pretraga podataka trenutno nije dostupna." :
          query.trim().length < 2 ? "Za pretragu podataka unesite najmanje dva znaka." :
            results.length === 0 ? "Nema rezultata." : ""}
      </div>
      <ul id={listId} role="listbox" aria-label="Rezultati pretrage" style={{maxHeight:320,overflowY:"auto",padding:8}}>
        {groups.map(group=><li key={group} role="group" aria-label={group}>
          <div className="gx-page-sub" aria-hidden="true">{group}</div>
          <ul role="presentation">{results.map((item,position)=>item.group === group ? <li key={`${group}:${item.href}:${position}`}
            id={`${listId}-${position}`} role="option" aria-selected={position === index} className="gx-menu-item"
            style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",background:position === index ? "var(--raise)" : undefined}}
            onMouseEnter={()=>setIndex(position)} onClick={()=>onNavigate(item.href)}><Icon name={item.icon}/><span>{item.label}</span></li> : null)}</ul>
        </li>)}
      </ul>
      <div style={{display:"flex",gap:12,padding:"8px 14px",borderTop:"1px solid var(--line)",fontSize:"var(--text-label)",color:"var(--muted)"}}>
        <span><kbd className="gx-search__key">↑↓</kbd> biraj</span><span><kbd className="gx-search__key">Enter</kbd> otvori</span>
        <span><kbd className="gx-search__key">Esc</kbd> zatvori</span>
      </div>
    </div>
  </div>;
}
