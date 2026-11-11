"use client";

/** Dijalozi rokova: nova obaveza, obnova (nova verzija) i detalj s prilozima. */
import { useEffect, useState } from "react";
import type { Obligation, ObligationType } from "@gradix/contracts";
import { apiCall, jsonBody } from "@/api-client";
import { formatDate } from "@/format";
import {
  Alert, Button, DataTable, DescriptionList, Dialog, FileUpload, Input, Mono, SectionTitle, Select, Skeleton,
} from "@/components/ui/index";
import {
  STATE_LABEL, daysLabel, targetLabel, type MachineOption, type WorkerOption,
} from "./obligations-client";

export function CreateDialog({
  types,
  returnFocusTo,
  onSaved,
  onClose,
}: {
  types: ObligationType[];
  returnFocusTo: HTMLElement | null;
  onSaved: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [typeId, setTypeId] = useState(types.find((type) => type.entityKind === "WORKER")?.id ?? types[0]?.id ?? "");
  const selected = types.find((type) => type.id === typeId) ?? null;
  const [workerId, setWorkerId] = useState("");
  const [machineId, setMachineId] = useState("");
  // R3: obaveza na projektu (dozvola, saglasnost, HSE elaborat).
  const [projectId, setProjectId] = useState("");
  const [number, setNumber] = useState("");
  const [issuer, setIssuer] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [workers, setWorkers] = useState<WorkerOption[] | null>(null);
  const [machines, setMachines] = useState<MachineOption[] | null>(null);
  const [projects, setProjects] = useState<{ id: string; code: string; name: string }[] | null>(null);

  const kind = selected?.entityKind ?? "WORKER";

  // Liste se traže tek kad su potrebne — ekran rokova ne čeka na radnike i mašine.
  useEffect(() => {
    if (kind === "WORKER" && workers === null) {
      void (async () => {
        const result = await apiCall<{ workers: WorkerOption[] }>("/api/workers");
        if (result.ok) setWorkers(result.data.workers);
      })();
    }
    if (kind === "MACHINE" && machines === null) {
      void (async () => {
        const result = await apiCall<{ machines: MachineOption[] }>("/api/equipment");
        if (result.ok) setMachines(result.data.machines);
      })();
    }
    if (kind === "PROJECT" && projects === null) {
      void (async () => {
        const result = await apiCall<{ projects: { id: string; code: string; name: string }[] }>("/api/projects");
        if (result.ok) setProjects(result.data.projects);
      })();
    }
  }, [kind, workers, machines, projects]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await apiCall<{ obligation: Obligation }>(
        "/api/obligations",
        jsonBody({
          typeId,
          workerId: kind === "WORKER" ? workerId : null,
          machineId: kind === "MACHINE" ? machineId : null,
          projectId: kind === "PROJECT" ? projectId : null,
          scopeCompany: kind === "COMPANY",
          number: number.trim() || null,
          issuer: issuer.trim() || null,
          issuedAt: issuedAt || null,
          expiresAt: expiresAt || null,
        }),
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await onSaved(`${selected?.label ?? "Obaveza"} je dodana.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Nova obaveza"
      hint="Tip određuje na šta se obaveza veže i koji su pragovi podsjetnika."
      returnFocusTo={returnFocusTo}
      onClose={onClose}
      wide
    >
      <form onSubmit={save} className="gx-stack">
        {error ? (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        ) : null}

        <Select
          label="Tip obaveze"
          id="new-type"
          hint={
            selected
              ? selected.defaultReminderDays.length > 0
                ? `Podsjetnik ${selected.defaultReminderDays.join("/")} dana prije roka.`
                : "Tip bez podsjetnika — vidi se samo kad istekne."
              : undefined
          }
          value={typeId}
          onChange={(event) => setTypeId(event.target.value)}
        >
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </Select>

        {kind === "WORKER" ? (
          <Select label="Radnik"id="new-worker"
              value={workerId}
              onChange={(event) => setWorkerId(event.target.value)}
              required
            >
              <option value="">— izaberite —</option>
              {(workers ?? []).filter((worker) => worker.isActive).map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.firstName} {worker.lastName}
                </option>
              ))}
            </Select>
        ) : null}

        {kind === "MACHINE" ? (
          <Select label="Mašina ili vozilo"id="new-machine"
              value={machineId}
              onChange={(event) => setMachineId(event.target.value)}
              required
            >
              <option value="">— izaberite —</option>
              {(machines ?? []).filter((machine) => machine.isActive).map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.code} · {machine.name}
                </option>
              ))}
            </Select>
        ) : null}

        {kind === "PROJECT" ? (
          <Select label="Projekat"id="new-project"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              required
            >
              <option value="">— izaberite —</option>
              {(projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} · {project.name}
                </option>
              ))}
            </Select>
        ) : null}

        {kind === "COMPANY" ? (
          <Alert tone="info">Ova obaveza se odnosi na cijelu firmu.</Alert>
        ) : null}

        <div className="gx-cols">
          <Input label="Broj dokumenta" id="new-number" value={number} onChange={(event) => setNumber(event.target.value)} maxLength={120} />
          <Input label="Izdavalac" id="new-issuer" value={issuer} onChange={(event) => setIssuer(event.target.value)} maxLength={200} />
        </div>

        <div className="gx-cols">
          <Input label="Datum izdavanja"id="new-issued"
              type="date"
              value={issuedAt}
              onChange={(event) => setIssuedAt(event.target.value)} />
          <Input label="Rok važenja" hint="Ostavite prazno samo kad obaveza nema rok (garancija)."id="new-expires"
              type="date"
              value={expiresAt}
              min={issuedAt || undefined}
              onChange={(event) => setExpiresAt(event.target.value)} />
        </div>

        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose} disabled={saving}>
            Otkaži
          </Button>
          <Button type="submit" variant="primary" fullWidthOnMobile disabled={saving || !typeId}>
            {saving ? "Čuvam…" : "Dodaj obavezu"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Obnova: nova verzija. Stara ostaje — to i piše u dijalogu, da niko ne pomisli da je izgubljena. */
export function RenewDialog({
  obligation,
  returnFocusTo,
  onSaved,
  onClose,
}: {
  obligation: Obligation;
  returnFocusTo: HTMLElement | null;
  onSaved: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [number, setNumber] = useState("");
  const [issuer, setIssuer] = useState(obligation.issuer ?? "");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await apiCall<{ obligation: Obligation }>(
        `/api/obligations/${obligation.id}/renew`,
        jsonBody({
          number: number.trim() || null,
          issuer: issuer.trim() || null,
          issuedAt: issuedAt || null,
          expiresAt,
        }),
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await onSaved(`${obligation.typeLabel} je obnovljena — verzija ${result.data.obligation.currentVersion}. Stara ostaje u historiji.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={`Obnova · ${obligation.typeLabel}`}
      hint={`${targetLabel(obligation)} · trenutni rok ${formatDate(obligation.expiresAt)} · verzija ${obligation.currentVersion}`}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
    >
      <form onSubmit={save} className="gx-stack">
        {error ? (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        ) : null}

        <Input label="Novi rok" hint="Mora biti poslije trenutnog roka."id="renew-expires"
            type="date"
            value={expiresAt}
            min={obligation.expiresAt ?? undefined}
            onChange={(event) => setExpiresAt(event.target.value)} required />

        <div className="gx-cols">
          <Input label="Novi broj dokumenta" id="renew-number" value={number} onChange={(event) => setNumber(event.target.value)} maxLength={120} />
          <Input label="Izdavalac" id="renew-issuer" value={issuer} onChange={(event) => setIssuer(event.target.value)} maxLength={200} />
        </div>

        <Input label="Datum izdavanja novog dokumenta"id="renew-issued"
            type="date"
            value={issuedAt}
            onChange={(event) => setIssuedAt(event.target.value)} />

        <p className="gx-page-sub">
          Stara verzija ostaje u historiji sa svojim rokom — ne prepisuje se.
        </p>

        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose} disabled={saving}>
            Otkaži
          </Button>
          <Button type="submit" variant="primary" fullWidthOnMobile disabled={saving || !expiresAt}>
            {saving ? "Obnavljam…" : "Obnovi"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Detalj: verzije i prilozi. Prilog se dodaje iz detalja jer tu ima smisla. */
export function DetailDialog({
  obligation,
  canManage,
  returnFocusTo,
  onChanged,
  onClose,
}: {
  obligation: Obligation;
  canManage: boolean;
  returnFocusTo: HTMLElement | null;
  onChanged: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<
    { version: number; expiresAt: string | null; number: string | null; issuer: string | null; createdAt: string }[] | null
  >(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await apiCall<{
        versions: { version: number; expiresAt: string | null; number: string | null; issuer: string | null; createdAt: string }[];
      }>(`/api/obligations/${obligation.id}`);
      if (result.ok) setVersions(result.data.versions);
    })();
  }, [obligation.id]);

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      // `sha256` i prvih 32 bajta: server po sadržaju odlučuje da li je PDF ili slika.
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const sha256 = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const head = Array.from(buffer.slice(0, 32));

      const registered = await apiCall<{ attachment: { id: string }; uploadUrl: string }>(
        `/api/obligations/${obligation.id}/attachments`,
        jsonBody({
          fileName: file.name,
          sizeBytes: file.size,
          sha256,
          headBase64: btoa(String.fromCharCode(...head)),
        }),
      );
      if (!registered.ok) {
        setMessage({ tone: "error", text: registered.message });
        return;
      }

      const put = await fetch(registered.data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: buffer,
      });
      if (!put.ok) {
        setMessage({ tone: "error", text: "Upload nije prošao. Pokušajte ponovo." });
        return;
      }

      const confirmed = await apiCall<{ attachment: { status: string } }>(
        `/api/obligations/${obligation.id}/attachments/${registered.data.attachment.id}/confirm`,
        { method: "POST" },
      );
      if (!confirmed.ok) {
        setMessage({ tone: "error", text: confirmed.message });
        return;
      }
      setMessage({ tone: "success", text: "Prilog je dodan." });
      await onChanged("Prilog je dodan uz obavezu.");
    } catch {
      setMessage({ tone: "error", text: "Upload nije prošao. Provjerite vezu i pokušajte ponovo." });
    } finally {
      setBusy(false);
    }
  }

  async function open(attachmentId: string) {
    const result = await apiCall<{ url: string }>(
      `/api/obligations/${obligation.id}/attachments/${attachmentId}/url`,
    );
    if (!result.ok) {
      setMessage({ tone: "error", text: result.message });
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <Dialog
      title={obligation.typeLabel}
      hint={`${targetLabel(obligation)} · rok ${formatDate(obligation.expiresAt)} · ${STATE_LABEL[obligation.state]}`}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
      wide
    >
      <div className="gx-stack gx-stack--5 gx-mt-5">
        {message ? (
          <Alert tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
            {message.text}
          </Alert>
        ) : null}

        <DescriptionList
          items={[
            { term: "Izdavalac", value: obligation.issuer ?? "—" },
            { term: "Broj", value: <Mono>{obligation.number ?? "—"}</Mono> },
            { term: "Izdato", value: <span className="gx-mono">{formatDate(obligation.issuedAt)}</span> },
            { term: "Rok", value: <span className="gx-mono">{formatDate(obligation.expiresAt)} ({daysLabel(obligation)})</span> },
            { term: "Odgovoran", value: obligation.responsibleName ?? "—" },
            { term: "Podsjetnici", value: obligation.reminderDays.length > 0 ? `${obligation.reminderDays.join(" / ")} dana prije roka` : "nema" },
          ]}
        />

        <section>
          <SectionTitle hint="Stara verzija ostaje — istorija je dokaz.">Verzije</SectionTitle>
          {versions === null ? (
            <Skeleton rows={2} />
          ) : (
            <DataTable
              caption="Verzije obaveze"
              rows={versions}
              rowKey={(entry) => String(entry.version)}
              emptyText="Nema verzija."
              columns={[
                { key: "version", header: "Verzija", cell: (entry) => <Mono>v{entry.version}</Mono> },
                { key: "expires", header: "Rok", cell: (entry) => formatDate(entry.expiresAt) },
                { key: "number", header: "Broj", cell: (entry) => entry.number ?? "—" },
              ]}
            />
          )}
        </section>

        <section>
          <SectionTitle hint="PDF ili slika, do 10 MB. Tip se provjerava po sadržaju.">Prilozi</SectionTitle>
          {obligation.attachments.length === 0 ? (
            <p className="gx-page-sub">Još nema priloga.</p>
          ) : (
            <ul className="gx-stack gx-stack--2 gx-mt-2">
              {obligation.attachments.map((attachment) => (
                <li key={attachment.id} className="gx-inline-flex">
                  <span>{attachment.fileName}</span>
                  <span className="gx-page-sub">
                    {(attachment.sizeBytes / 1024).toFixed(0)} kB
                  </span>
                  <Button onClick={() => void open(attachment.id)}>Otvori</Button>
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <div className="gx-mt-3">
              <FileUpload
                label="Dodaj prilog"
                hint="PDF ili slika, do 10 MB."
                accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
                onFiles={(files) => { const file = files[0]; if (file) void upload(file); }}
              />
            </div>
          ) : null}
        </section>

        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose}>
            Zatvori
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
