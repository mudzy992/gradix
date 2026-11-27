"use client";

/**
 * F9 — jedan dan dnevnika: ručni unos, količine, zastoji, potpis i PDF.
 *
 * Tri odluke koje se vide u kodu:
 *
 *  1. **Automatske sekcije su READ-ONLY.** Radnici, mašine, ture i kvarovi dolaze iz Modula 3/5;
 *     da se ovdje mogu prepraviti, dnevnik bi bio drugo mjesto gdje sati mogu biti drugačiji od
 *     evidencije. Ispravka se radi u evidenciji, a dnevnik je pokazuje.
 *  2. **`frozen` je vidljiv, ne skriven.** Poslije potpisa podaci su zamrznuti; ekran to kaže
 *     riječima, jer bi inače čovjek pomislio da je osvježavanje pokvarilo brojeve.
 *  3. **`DRAFT_FORMAT` upozorenje je na vrhu**, ne u fusnoti: dok obrazac nije potvrđen, PDF nije
 *     zakonski obrazac i to mora biti prvo što se pročita.
 */
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Card, DescriptionList, Field, Inline, Input,
  SectionTitle, Stack, StatusDot, TabPanel, Tabs, Textarea, TextLink,
} from "@/components/ui/index";
import type { SiteDiaryDetail } from "@gradix/contracts";
import { DnevnikForm } from "./dnevnik-form";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Nacrt — nije potpisan",
  SIGNED: "Potpisan",
  LOCKED: "Zaključan",
};

const hours = (value: string | number): string => Number(value).toFixed(2);

export function DnevnikDetailClient({
  detail,
  caps,
}: {
  detail: SiteDiaryDetail;
  caps: { canManage: boolean; canSign: boolean };
}) {
  const router = useRouter();
  const diary = detail.diary;
  const editable = caps.canManage && diary.status !== "LOCKED";
  const [tab, setTab] = useState("automatic");
  const [signedName, setSignedName] = useState(diary.signedName ?? "");
  const [revision, setRevision] = useState({ reason: "", description: "" });
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, request: () => Promise<{ ok: boolean; message?: string }>, success: string) => {
      setBusy(key);
      setNotice(null);
      const result = await request();
      setBusy(null);
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message ?? "Radnja nije uspjela." });
        return;
      }
      setNotice({ tone: "success", text: success });
      router.refresh();
    },
    [router],
  );

  const sign = () =>
    run("sign", () => apiCall(`/api/site-diaries/${diary.id}/sign`, jsonBody({ signedName })),
      "Dnevnik je potpisan; automatski podaci su zamrznuti.");

  const lock = () =>
    run("lock", () => apiCall(`/api/site-diaries/${diary.id}/lock`, jsonBody({})),
      "Dnevnik je zaključan. Ispravka ide kroz reviziju.");

  const revise = () =>
    run("revise", () => apiCall(`/api/site-diaries/${diary.id}/revise`, jsonBody({
      reason: revision.reason,
      description: revision.description || undefined,
    })), "Revizija je zabilježena.");

  const autoSummary = useMemo(() => [
    { term: "Radnici", value: `${detail.auto.workers.length}` },
    { term: "Sati radnika", value: `${detail.auto.workedHours} h` },
    { term: "Mašine", value: `${detail.auto.machines.length}` },
    { term: "Ture", value: `${detail.auto.hauls.length}` },
    { term: "Kvarovi", value: `${detail.auto.faults.length}` },
  ], [detail.auto]);

  return (
    <Stack gap="var(--space-5)">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <Alert tone={diary.status === "LOCKED" ? "info" : "warning"}>
        PDF izvoz nosi oznaku <strong>DRAFT_FORMAT</strong> dok vlasnik ili pravnik ne potvrdi šablon
        obrasca — do tada dokument nije zakonski obrazac, nego nacrt sadržaja.
      </Alert>

      <Card>
        <SectionTitle
          action={
            <Inline>
              <a className="gx-link" href={`/api/site-diaries/${diary.id}/pdf`}>Preuzmi PDF</a>
              <StatusDot
                tone={diary.status === "LOCKED" ? "ok" : diary.status === "SIGNED" ? "warn" : "danger"}
                label={STATUS_LABEL[diary.status] ?? diary.status}
              />
            </Inline>
          }
        >
          Dan
        </SectionTitle>
        <DescriptionList
          items={[
            { term: "Datum", value: diary.diaryDate },
            { term: "Projekat", value: `${diary.projectCode} — ${diary.projectName}` },
            { term: "Potpisao", value: diary.signedName ?? "—" },
            { term: "Ukupno zastoja", value: `${detail.delayHoursTotal} h` },
            { term: "Zaključan", value: diary.lockedAt ? diary.lockedAt.slice(0, 16).replace("T", " ") : "—" },
          ]}
        />
        {detail.frozen ? (
          <Alert tone="info">
            Automatski podaci su zamrznuti u trenutku potpisa — PDF i ekran pokazuju iste brojeve, i
            poslije izmjena u evidenciji.
          </Alert>
        ) : null}
      </Card>

      <Tabs id="dnevnik" label="Dnevnik" active={tab} onChange={setTab} tabs={[
        {key:"automatic",label:"Podaci s terena"},{key:"entries",label:"Unosi"},
        ...(caps.canSign ? [{key:"sign",label:"Potpis i zaključavanje"}] : []),{key:"attachments",label:"Prilozi"},
      ]} />
      <TabPanel groupId="dnevnik" tabKey="automatic" active={tab === "automatic"}><Card>
        <SectionTitle hint="Sistem, ne prepisivanje — ispravka se radi u evidenciji">Automatski iz terena</SectionTitle>
        <Inline>
          {autoSummary.map((entry) => (
            <StatusDot key={entry.term} tone="muted" label={`${entry.term}: ${entry.value}`} />
          ))}
        </Inline>
        <Stack gap="var(--space-3)">
          <div>
            <strong>Radnici i sati</strong>
            {detail.auto.workers.length === 0 ? (
              <p className="gx-page-sub">Nema evidentiranih radnika za ovaj projekat i dan.</p>
            ) : (
              <ul>
                {detail.auto.workers.map((worker) => (
                  <li key={worker.workerId}>{worker.workerName} — {hours(worker.hours)} h</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <strong>Mašine i sati</strong>
            {detail.auto.machines.length === 0 ? (
              <p className="gx-page-sub">Nema sati mašina za taj dan.</p>
            ) : (
              <ul>
                {detail.auto.machines.map((machine) => (
                  <li key={machine.machineId}>
                    {machine.machineCode} {machine.machineName} — {hours(machine.hours)} h
                    {machine.meterFrom && machine.meterTo ? ` (${machine.meterFrom} → ${machine.meterTo})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {detail.auto.hauls.length > 0 ? (
            <div>
              <strong>Ture</strong>
              <ul>
                {detail.auto.hauls.map((haul) => (
                  <li key={haul.haulId}>
                    {haul.machineName} — {haul.material ?? "materijal"}: {haul.quantity} {haul.quantityUnit}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {detail.auto.faults.length > 0 ? (
            <div>
              <strong>Kvarovi i zastoji</strong>
              <ul>
                {detail.auto.faults.map((fault) => (
                  <li key={fault.faultId}>
                    {fault.machineName}: {fault.title}
                    {fault.downtimeMinutes === null ? "" : ` (${fault.downtimeMinutes} min)`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Stack>
      </Card></TabPanel>

      <TabPanel groupId="dnevnik" tabKey="entries" active={tab === "entries"}><DnevnikForm detail={detail} editable={editable} onNotice={setNotice} /></TabPanel>

      {caps.canSign ? <TabPanel groupId="dnevnik" tabKey="sign" active={tab === "sign"}>
        <Card>
          <SectionTitle hint="Potpis zamrzava automatske podatke">Potpis i zaključavanje</SectionTitle>
          {diary.status === "DRAFT" ? (
            <Inline>
              <Field label="Ime potpisnika" htmlFor="potpis-ime">
                <Input id="potpis-ime" value={signedName} onChange={(event) => setSignedName(event.target.value)} />
              </Field>
              <Button variant="primary" onClick={sign} disabled={busy === "sign" || signedName.trim().length < 2}>
                Potpiši dnevnik
              </Button>
            </Inline>
          ) : null}
          {diary.status === "SIGNED" ? (
            <Button onClick={lock} disabled={busy === "lock"}>Zaključaj dnevnik</Button>
          ) : null}
          {diary.status === "LOCKED" ? (
            <Stack gap="var(--space-3)">
              <Alert tone="info">
                Zaključan dnevnik se ne mijenja direktno. Ispravka ide kroz reviziju sa razlogom, a stari
                sadržaj ostaje u zapisu.
              </Alert>
              <Field label="Razlog ispravke (bar 10 znakova)" htmlFor="revizija-razlog">
                <Textarea
                  id="revizija-razlog"
                  rows={2}
                  value={revision.reason}
                  onChange={(event) => setRevision((current) => ({ ...current, reason: event.target.value }))}
                />
              </Field>
              <Field label="Novi opis radova (opciono)" htmlFor="revizija-opis">
                <Textarea
                  id="revizija-opis"
                  rows={2}
                  value={revision.description}
                  onChange={(event) => setRevision((current) => ({ ...current, description: event.target.value }))}
                />
              </Field>
              <Button onClick={revise} disabled={busy === "revise" || revision.reason.trim().length < 10}>
                Zapiši reviziju
              </Button>
            </Stack>
          ) : null}
        </Card>
      </TabPanel> : null}

      <TabPanel groupId="dnevnik" tabKey="attachments" active={tab === "attachments"}><Card>
        <SectionTitle action={<TextLink href="/ured/dnevnik">Nazad na listu</TextLink>}>Prilozi</SectionTitle>
        {detail.attachments.length === 0 ? (
          <p className="gx-page-sub">Nema priloga uz ovaj dan.</p>
        ) : (
          <ul>
            {detail.attachments.map((file) => (
              <li key={file.id}>
                {file.file_name} — {file.status === "pending" ? "upload u toku" : "potvrđeno"}
              </li>
            ))}
          </ul>
        )}
      </Card></TabPanel>
    </Stack>
  );
}
