"use client";

import { useCallback, useEffect, useState } from "react";
import { REPORT_DEFINITIONS, type ReportKey } from "@gradix/domain";
import type { ReportJob, ReportJobsResponse, ProjectsResponse } from "@gradix/contracts";
import { apiCall, jsonBody } from "@/api-client";
import { Button, Card, FilterBar, Input, PageHeader, Select } from "@/components/ui/index";

type Job=typeof ReportJob._output;
const statusLabels:Record<Job["status"],string>={QUEUED:"Na čekanju",RUNNING:"U obradi",DONE:"Spremno",FAILED:"Neuspjelo",DEAD:"Neuspjelo"};
const noTeam:ReportKey[]=["PROJECT_COSTS","DEADLINES","HSE"];

export function ReportsClient({keys,canExport,canSeeProjects}:{keys:ReportKey[];canExport:boolean;canSeeProjects:boolean}) {
  const today=new Date().toISOString().slice(0,10);
  const [key,setKey]=useState<ReportKey | "">(keys[0] ?? "");
  const [from,setFrom]=useState(`${today.slice(0,7)}-01`), [to,setTo]=useState(today);
  const [format,setFormat]=useState<"pdf"|"xlsx">("pdf");
  const [projectId,setProjectId]=useState(""), [team,setTeam]=useState("");
  const [projects,setProjects]=useState<typeof ProjectsResponse._output["projects"]>([]);
  const [projectsError,setProjectsError]=useState(false);
  const [jobs,setJobs]=useState<Job[] | null>(null), [error,setError]=useState<string | null>(null);
  const [notice,setNotice]=useState<string | null>(null), [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{
    const result=await apiCall<typeof ReportJobsResponse._output>("/api/report-jobs");
    if (result.ok) setJobs(result.data.jobs); else setError(result.message);
  },[]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),15_000);return ()=>clearInterval(timer);},[refresh]);
  useEffect(()=>{
    let alive=true;
    if (canSeeProjects) void apiCall<typeof ProjectsResponse._output>("/api/projects").then(result=>{
      if (!alive) return;
      if (result.ok) setProjects(result.data.projects); else setProjectsError(true);
    });
    return ()=>{alive=false;};
  },[canSeeProjects]);
  function params() {
    return {from,to,format,...(projectId ? {projectId} : {}),...(team.trim() ? {team:team.trim()} : {})};
  }
  async function enqueue() {
    if (!key) return;
    setBusy(true);setError(null);setNotice(null);
    try {
      const result=await apiCall<Job>("/api/report-jobs",jsonBody({key,...params()}));
      if (!result.ok) setError(result.message);
      else {setNotice("Izvještaj je poslan na obradu. Status će se osvježavati automatski.");await refresh();}
    } finally {setBusy(false);}
  }
  async function downloadNow() {
    if (!key) return;
    setBusy(true);setError(null);setNotice(null);
    try {
      const query=new URLSearchParams(params());
      const response=await fetch(`/api/reports/${key}?${query}`,{cache:"no-store"});
      if (!response.ok) {
        const body=await response.json().catch(()=>null) as {error?:{message?:string}} | null;
        setError(body?.error?.message ?? "Izvoz nije uspio.");return;
      }
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement("a");link.href=url;link.download=`${key.toLowerCase()}.${format}`;link.click();
      URL.revokeObjectURL(url);
    } catch {setError("Nema veze sa serverom. Pokušajte ponovo.");}
    finally {setBusy(false);}
  }
  async function downloadJob(job:Job) {
    setError(null);
    const result=await apiCall<{url:string}>(`/api/report-jobs/${encodeURIComponent(job.id)}/download`);
    if (!result.ok) {setError(result.message);return;}
    try {
      const url=new URL(result.data.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid URL");
      window.location.assign(url.href);
    } catch {setError("Veza za preuzimanje nije ispravna.");}
  }
  const valid=Boolean(key && from && to && to>=from && (Date.parse(to)-Date.parse(from) <= 366*86400000));
  return <div>
    <PageHeader title="Izvještaji" subtitle="Izaberite period i format. Veće izvještaje pošaljite na obradu u pozadini." />
    <Card>
      <h2 className="gx-section-title">Novi izvještaj</h2>
      {!keys.length ? <p>Za vašu ulogu nema dostupnih izvora izvještaja.</p> : <>
        <FilterBar>
          <Select label="Izvještaj" value={key} onChange={event=>{const next=event.target.value as ReportKey;setKey(next);if(noTeam.includes(next)) setTeam("");}}>
            {keys.map(item=><option key={item} value={item}>{REPORT_DEFINITIONS[item].title}</option>)}
          </Select>
          <Input label="Od" type="date" value={from} onChange={event=>setFrom(event.target.value)} />
          <Input label="Do" type="date" value={to} onChange={event=>setTo(event.target.value)} />
          <Select label="Format" value={format} onChange={event=>setFormat(event.target.value as "pdf"|"xlsx")}><option value="pdf">PDF</option><option value="xlsx">Excel (XLSX)</option></Select>
          {canSeeProjects ? <Select label="Projekat" value={projectId} onChange={event=>setProjectId(event.target.value)}>
            <option value="">Svi dostupni projekti</option>{projects.map(project=><option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
          </Select> : null}
          <Input label="Tim" value={team} disabled={!key || noTeam.includes(key)} onChange={event=>setTeam(event.target.value)} maxLength={128} />
        </FilterBar>
        {projectsError ? <p role="alert">Nije moguće učitati projekte.</p> : null}
        {key && noTeam.includes(key) ? <p className="gx-page-sub">Filter tima nije dostupan za ovaj izvještaj.</p> : null}
        {!valid ? <p>Izaberite ispravan period od najviše 367 dana.</p> : null}
        {!canExport ? <p>Nemate pravo izvoza podataka.</p> : <div className="gx-inline-flex">
          <Button variant="primary" onClick={()=>void downloadNow()} disabled={!valid || busy}>Preuzmi odmah</Button>
          <Button onClick={()=>void enqueue()} disabled={!valid || busy}>Pošalji na obradu</Button>
        </div>}
      </>}
      {notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert">{error}</p> : null}
    </Card>
    <Card>
      <div className="gx-section-head"><h2 className="gx-section-title">Moji izvještaji u pozadini</h2><Button onClick={()=>void refresh()}>Osvježi statuse</Button></div>
      {jobs === null ? <p>Učitavanje poslova…</p> : !jobs.length ? <p>Još nema poslova.</p> : <ul className="gx-stack gx-stack--2">
        {jobs.map(job=><li key={job.id}><strong>{REPORT_DEFINITIONS[job.key as ReportKey]?.title ?? job.key}</strong> · {job.from} – {job.to} · {job.format.toUpperCase()} · {statusLabels[job.status]}
          {job.error ? <span> · {job.error}</span> : null}{job.status === "DONE" ? <Button onClick={()=>void downloadJob(job)}>Preuzmi {job.format.toUpperCase()}</Button> : null}</li>)}
      </ul>}
    </Card>
  </div>;
}
