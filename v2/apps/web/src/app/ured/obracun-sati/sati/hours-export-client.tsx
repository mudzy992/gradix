"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert, Button, DataTable, EmptyState, FilterBar, Input, Stack,
} from "@/components/ui/index";
import type { HoursExportRow } from "@/server/hours-export-types";

export function HoursExportClient({
  initialFrom,
  initialTo,
  initialRows,
  canReportExport = false,
}: {
  initialFrom: string;
  initialTo: string;
  initialRows: HoursExportRow[];
  canReportExport?: boolean;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    setFrom(initialFrom);
    setTo(initialTo);
  }, [initialFrom, initialTo]);

  const columns = useMemo(() => ([
    { key: "worker", header: "Radnik", cell: (row: HoursExportRow) => row.worker },
    { key: "date", header: "Datum", cell: (row: HoursExportRow) => row.date },
    { key: "hours", header: "Sati", cell: (row: HoursExportRow) => row.hours },
    { key: "project", header: "Projekat", cell: (row: HoursExportRow) => row.project },
    { key: "status", header: "Status", cell: (row: HoursExportRow) => row.status },
  ]), []);

  const handleApply = () => {
    if (!from || !to) {
      setNotice({ tone: "error", text: "Unesite period (od–do)." });
      return;
    }
    if (from > to) {
      setNotice({ tone: "error", text: "Datum „od“ ne smije biti poslije „do“." });
      return;
    }
    setNotice(null);
    router.push(`/ured/obracun-sati/sati?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  };

  const handleExport = async () => {
    if (!from || !to || from > to) {
      setNotice({ tone: "error", text: "Ispravite period prije izvoza." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/workdays/hours-export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setNotice({ tone: "error", text: body?.error?.message ?? "Izvoz nije uspio." });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `obracun-sati-${from}-${to}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice({ tone: "success", text: "CSV je preuzet." });
    } catch {
      setNotice({ tone: "error", text: "Nema veze sa serverom. Pokušajte ponovo." });
    } finally {
      setBusy(false);
    }
  };

  const handleReportExport = async (format: "pdf" | "xlsx") => {
    if (!from || !to || from > to) { setNotice({tone:"error",text:"Ispravite period prije izvoza."}); return; }
    setBusy(true); setNotice(null);
    try {
      const query=new URLSearchParams({from,to,format});
      const response=await fetch(`/api/reports/WORK_HOURS?${query}`,{credentials:"same-origin"});
      if (!response.ok) {
        const body=await response.json().catch(()=>null) as {error?:{message?:string}} | null;
        setNotice({tone:"error",text:body?.error?.message ?? "Izvoz nije uspio."}); return;
      }
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement("a"); link.href=url; link.download=`radni-sati-${from}-${to}.${format}`; link.click();
      URL.revokeObjectURL(url); setNotice({tone:"success",text:`${format.toUpperCase()} je preuzet.`});
    } catch { setNotice({tone:"error",text:"Nema veze sa serverom. Pokušajte ponovo."}); }
    finally {setBusy(false);}
  };

  const filtersChanged = from !== initialFrom || to !== initialTo;
  return (
    <Stack gap="var(--space-5)">
      {notice ? <Alert tone={notice.tone} role="status">{notice.text}</Alert> : null}
      <FilterBar>
        <Input label="Od" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="Do" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button variant="quiet" disabled={busy} onClick={handleApply}>Prikaži</Button>
        <Button variant="primary" disabled={busy || filtersChanged} onClick={() => void handleExport()}>
          Preuzmi CSV
        </Button>
        {canReportExport ? <>
          <Button disabled={busy || filtersChanged} onClick={()=>void handleReportExport("pdf")}>Preuzmi PDF</Button>
          <Button disabled={busy || filtersChanged} onClick={()=>void handleReportExport("xlsx")}>Preuzmi XLSX</Button>
        </> : null}
      </FilterBar>
      {filtersChanged ? <p>Primijenite period prije izvoza prikazanih sati.</p> : null}
      {initialRows.length === 0 ? (
        <EmptyState
          title="Nema sati u periodu"
          description="Prikazuju se samo potvrđeni (CONFIRMED) i zaključani (LOCKED) dani."
        />
      ) : (
        <DataTable
          caption="Sati za obračun"
          columns={columns}
          rows={initialRows}
          rowKey={(row) => `${row.workerId}-${row.date}-${row.projectId}-${row.status}`}
        />
      )}
    </Stack>
  );
}
