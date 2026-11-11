"use client";

/** Dijalozi rokova: nova obaveza, obnova (nova verzija) i detalj s prilozima. */
import { useEffect, useState } from "react";
import type { Obligation, ObligationType } from "@gradix/contracts";
import { apiCall, jsonBody } from "@/api-client";
import { formatDate } from "@/format";
import {
  Alert, Button, Dialog, Input, Select,
} from "@/components/ui/index";
import { targetLabel, type MachineOption, type WorkerOption } from "./obligations-client";

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
