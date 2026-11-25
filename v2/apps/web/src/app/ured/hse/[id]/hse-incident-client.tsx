"use client";

/**
 * F9 — jedan incident: činjenice, dopune, istraga, mjere i zatvaranje.
 *
 * Pravilo koje ekran sprovodi: **nema forme za izmjenu opisa.** Dopuna je novo polje koje dodaje
 * izjavu (`hse_incident_updates`); činjenice ostaju kakve su prijavljene. Dugme „Zatvori“ je
 * onemogućeno sa objašnjenjem koje tačno nedostaje — ne sakriveno, jer čovjek tada ne zna šta da
 * uradi (§1.3).
 */
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, jsonBody } from "@/api-client";
import {
  Alert, Button, Card, Checkbox, DataTable, DescriptionList, Field, FormGrid, Inline, Input,
  SectionTitle, Select, Stack, StatusDot, Textarea,
} from "@/components/ui/index";
import type { HseIncidentDetail } from "@gradix/contracts";

const KIND_LABEL: Record<string, string> = {
  ACCIDENT: "Nesreća",
  NEAR_MISS: "NEAR_MISS (skoro pa)",
  PROPERTY_DAMAGE: "Šteta na imovini",
  ENVIRONMENTAL: "Okoliš",
  OCCUPATIONAL_ILLNESS: "Bolest u vezi s radom",
};

const STATUS_LABEL: Record<string, string> = {
  REPORTED: "Prijavljen",
  INVESTIGATING: "U istrazi",
  ACTIONS_OPEN: "Otvorene mjere",
  CLOSED: "Zatvoren",
};

export function HseIncidentClient({
  detail,
  caps,
}: {
  detail: HseIncidentDetail;
  caps: { canReport: boolean; canInvestigate: boolean };
}) {
  const router = useRouter();
  const incident = detail.incident;
  const [update, setUpdate] = useState("");
  const [investigation, setInvestigation] = useState({
    rootCause: detail.investigation?.rootCause ?? "",
    method: detail.investigation?.method ?? "FIVE_WHY",
    findings: detail.investigation?.findings ?? "",
    completed: Boolean(detail.investigation?.completedAt),
  });
  const [action, setAction] = useState({ description: "", responsibleWorkerId: "", dueOn: "" });
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
        return false;
      }
      setNotice({ tone: "success", text: success });
      router.refresh();
      return true;
    },
    [router],
  );

  const addUpdate = () =>
    run("update", () => apiCall(`/api/hse/incidents/${incident.id}/updates`, jsonBody({ body: update })),
      "Dopuna je zabilježena.").then((ok) => { if (ok) setUpdate(""); });

  const saveInvestigation = () =>
    run("investigation", () => apiCall(`/api/hse/incidents/${incident.id}/investigation`, {
      method: "PUT",
      ...jsonBody({
        rootCause: investigation.rootCause,
        method: investigation.method,
        findings: investigation.findings || null,
        completed: investigation.completed,
      }),
    }), "Istraga je sačuvana.");

  const addAction = () =>
    run("action", () => apiCall("/api/hse/actions/create", jsonBody({
      incidentId: incident.id,
      description: action.description,
      responsibleWorkerId: action.responsibleWorkerId,
      dueOn: action.dueOn,
    })), "Mjera je otvorena.");

  const closeIncident = () =>
    run("close", () => apiCall(`/api/hse/incidents/${incident.id}/close`, jsonBody({})),
      "Incident je zatvoren.");

  const completeAction = (id: string) =>
    run(`action-${id}`, () => apiCall("/api/hse/actions", {
      method: "PATCH",
      ...jsonBody({ id, kind: "DONE" }),
    }), "Mjera je završena.");

  const overdue = detail.actions.filter((entry) => entry.overdue).length;

  return (
    <Stack gap="var(--space-5)">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {detail.needsReportObligation ? (
        <Alert tone="error" role="alert">
          Prijava tvrdi obavezu prijave inspekciji, ali obaveza još ne postoji. Otvorite je u Rokovima
          (tip `HSE_REPORT`) — bez nje rok niko ne prati.
        </Alert>
      ) : null}
      {overdue > 0 ? (
        <Alert tone="warning" role="alert">
          {overdue} {overdue === 1 ? "mjera kasni" : "mjere kasne"} — rok je prošao, a mjera je otvorena.
        </Alert>
      ) : null}

      <Card>
        <SectionTitle
          action={
            <StatusDot
              tone={incident.status === "CLOSED" ? "ok" : incident.status === "REPORTED" ? "warn" : "danger"}
              label={STATUS_LABEL[incident.status] ?? incident.status}
            />
          }
        >
          Činjenice (ne mijenjaju se)
        </SectionTitle>
        <DescriptionList
          items={[
            { term: "Vrsta", value: KIND_LABEL[incident.kind] ?? incident.kind },
            { term: "Težina", value: incident.severity },
            { term: "Kada", value: incident.occurredAt.slice(0, 16).replace("T", " ") },
            { term: "Projekat", value: incident.projectName ?? "—" },
            { term: "Lokacija", value: incident.locationText ?? "—" },
            { term: "Prijavio", value: incident.reporterName ?? "—" },
            { term: "Povrijeđeni", value: incident.injuredName ?? "—" },
            { term: "Izgubljeni dani", value: String(incident.lostDays) },
            { term: "Prijava inspekciji", value: incident.reportableToAuthority ? "da" : "ne" },
            { term: "Obaveza prijave", value: incident.reportObligationId ?? "nije otvorena" },
          ]}
        />
        <p className="gx-page-sub">{incident.description}</p>
        {incident.immediateAction ? (
          <p className="gx-page-sub"><strong>Odmah urađeno:</strong> {incident.immediateAction}</p>
        ) : null}
      </Card>

      <Card>
        <SectionTitle hint="Append-only: izjava se dodaje, prva se ne prepisuje">Dopune i izjave</SectionTitle>
        {detail.updates.length === 0 ? (
          <p className="gx-page-sub">Nema dopuna.</p>
        ) : (
          <ul>
            {detail.updates.map((entry) => (
              <li key={entry.id}>
                {entry.createdAt.slice(0, 16).replace("T", " ")} — {entry.authorName}: {entry.body}
              </li>
            ))}
          </ul>
        )}
        {caps.canReport ? (
          <Inline>
            <Field label="Nova dopuna" htmlFor="dopuna-tekst">
              <Textarea
                id="dopuna-tekst"
                rows={2}
                value={update}
                onChange={(event) => setUpdate(event.target.value)}
              />
            </Field>
            <Button onClick={addUpdate} disabled={busy === "update" || update.trim().length === 0}>
              Dodaj dopunu
            </Button>
          </Inline>
        ) : null}
      </Card>

      <Card>
        <SectionTitle hint="Jedna istraga po incidentu — dva uzroka znače dvije istine">
          Istraga
        </SectionTitle>
        <FormGrid>
          <Field label="Uzrok" htmlFor="istraga-uzrok">
            <Textarea
              id="istraga-uzrok"
              rows={2}
              value={investigation.rootCause}
              onChange={(event) => setInvestigation((current) => ({ ...current, rootCause: event.target.value }))}
              disabled={!caps.canInvestigate}
            />
          </Field>
          <Field label="Metod" htmlFor="istraga-metod">
            <Select
              id="istraga-metod"
              value={investigation.method}
              onChange={(event) => setInvestigation((current) => ({ ...current, method: event.target.value }))}
              disabled={!caps.canInvestigate}
            >
              <option value="FIVE_WHY">5 zašto</option>
              <option value="FISHBONE">Ishikawa</option>
              <option value="OTHER">Drugo</option>
            </Select>
          </Field>
        </FormGrid>
        <Field label="Nalazi" htmlFor="istraga-nalazi">
          <Textarea
            id="istraga-nalazi"
            rows={2}
            value={investigation.findings}
            onChange={(event) => setInvestigation((current) => ({ ...current, findings: event.target.value }))}
            disabled={!caps.canInvestigate}
          />
        </Field>
        {caps.canInvestigate ? (
          <Inline>
            <Checkbox
              label="Istraga je završena"
              checked={investigation.completed}
              onChange={(event) => setInvestigation((current) => ({ ...current, completed: event.target.checked }))}
            />
            <Button onClick={saveInvestigation} disabled={busy === "investigation"}>
              Sačuvaj istragu
            </Button>
          </Inline>
        ) : (
          <p className="gx-page-sub">{detail.investigation?.completedAt ? "Istraga je završena." : "Istraga nije završena."}</p>
        )}
      </Card>

      <Card>
        <SectionTitle hint="Jedna tabela mjera za incidente i inspekcije">Korektivne mjere</SectionTitle>
        <DataTable
          rows={detail.actions}
          rowKey={(row) => row.id}
          caption="Korektivne mjere"
          emptyText="Nema mjera. Mjera bez odgovornog i roka nije mjera — ne može se otvoriti."
          columns={[
            { key: "opis", header: "Mjera", cell: (row) => row.description },
            { key: "rok", header: "Rok", cell: (row) => row.dueOn },
            { key: "odgovoran", header: "Odgovoran", cell: (row) => row.responsibleName ?? "—" },
            {
              key: "stanje",
              header: "Stanje",
              cell: (row) => (
                <StatusDot
                  tone={row.status === "DONE" ? "ok" : row.overdue ? "danger" : "warn"}
                  label={row.status === "OPEN" ? (row.overdue ? "kasni" : "otvorena") : row.status === "DONE" ? "završena" : "otkazana"}
                />
              ),
            },
            ...(caps.canInvestigate
              ? [{
                key: "akcija",
                header: "",
                cell: (row: HseIncidentDetail["actions"][number]) =>
                  row.status === "OPEN"
                    ? (
                      <Button variant="quiet" onClick={() => completeAction(row.id)} disabled={busy === `action-${row.id}`}>
                        Završi
                      </Button>
                    )
                    : null,
              }]
              : []),
          ]}
        />
        {caps.canInvestigate ? (
          <FormGrid>
            <Field label="Opis mjere" htmlFor="mjera-opis">
              <Input
                id="mjera-opis"
                value={action.description}
                onChange={(event) => setAction((current) => ({ ...current, description: event.target.value }))}
              />
            </Field>
            <Field label="ID odgovornog radnika" htmlFor="mjera-odgovorni" hint="Bez odgovornog mjera se odbija.">
              <Input
                id="mjera-odgovorni"
                value={action.responsibleWorkerId}
                onChange={(event) => setAction((current) => ({ ...current, responsibleWorkerId: event.target.value }))}
              />
            </Field>
            <Field label="Rok" htmlFor="mjera-rok">
              <Input
                id="mjera-rok"
                type="date"
                value={action.dueOn}
                onChange={(event) => setAction((current) => ({ ...current, dueOn: event.target.value }))}
              />
            </Field>
            <Button
              onClick={addAction}
              disabled={busy === "action" || action.description.trim().length < 5 || !action.responsibleWorkerId || !action.dueOn}
            >
              Otvori mjeru
            </Button>
          </FormGrid>
        ) : null}
      </Card>

      {detail.attachments.length > 0 ? (
        <Card>
          <SectionTitle>Prilozi</SectionTitle>
          <ul>
            {detail.attachments.map((file) => (
              <li key={file.id}>{file.file_name} — {file.status === "pending" ? "upload u toku" : "potvrđeno"}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {caps.canInvestigate && incident.status !== "CLOSED" ? (
        <Card>
          <SectionTitle hint="Traži završenu istragu i nijednu otvorenu mjeru">Zatvaranje</SectionTitle>
          <Inline>
            <Button
              variant="primary"
              onClick={closeIncident}
              disabled={busy === "close" || !detail.investigation?.completedAt || detail.actions.some((entry) => entry.status === "OPEN")}
            >
              Zatvori incident
            </Button>
            {!detail.investigation?.completedAt ? (
              <span className="gx-page-sub">Nedostaje završena istraga.</span>
            ) : detail.actions.some((entry) => entry.status === "OPEN") ? (
              <span className="gx-page-sub">Postoji otvorena mjera — završite je ili otkažite sa razlogom.</span>
            ) : null}
          </Inline>
        </Card>
      ) : null}
    </Stack>
  );
}
