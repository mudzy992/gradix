/**
 * Dijeljeni obrazac projekta (A2): stanje forme, prevodi statusa i konverzije
 * ugovor ⇄ forma. Dijalog dodjele i dijalog projekta uvoze odatle direktno,
 * umjesto preko klijenta (ciklus klijent ↔ dijalozi ↔ detalj).
 */
import type { Project } from "@gradix/contracts";

export const STATUS_LABEL: Record<string, string> = {
  PLANNED: "U planu",
  ACTIVE: "Aktivan",
  PAUSED: "Pauziran",
  FINISHED: "Završen",
  CANCELLED: "Otkazan",
};

export type WorkerOption = { id: string; firstName: string; lastName: string; isActive: boolean };
export type MachineOption = { id: string; code: string; name: string; isActive: boolean };

export const PROJECT_EMPTY_FORM = {
  code: "",
  name: "",
  status: "ACTIVE",
  sitePlace: "",
  siteAddress: "",
  startsOn: "",
  endsOn: "",
  managerWorkerId: "",
  note: "",
};

export type ProjectFormState = typeof PROJECT_EMPTY_FORM;

export const fromProject = (project: Project): ProjectFormState => ({
  code: project.code,
  name: project.name,
  status: project.status,
  sitePlace: project.sitePlace ?? "",
  siteAddress: project.siteAddress ?? "",
  startsOn: project.startsOn?.slice(0, 10) ?? "",
  endsOn: project.endsOn?.slice(0, 10) ?? "",
  managerWorkerId: project.managerWorkerId ?? "",
  note: project.note ?? "",
});

/** Prazno se šalje kao `null`, ne kao `""` — isto pravilo kao na ekranu radnika. */
export const toProjectPayload = (form: ProjectFormState) => ({
  code: form.code.trim(),
  name: form.name.trim(),
  status: form.status,
  sitePlace: form.sitePlace.trim() || null,
  siteAddress: form.siteAddress.trim() || null,
  startsOn: form.startsOn || null,
  endsOn: form.endsOn || null,
  managerWorkerId: form.managerWorkerId || null,
  note: form.note.trim() || null,
});
