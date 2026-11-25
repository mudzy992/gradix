/**
 * F9 — offline sync za dnevnik građenja i HSE (spec 10 §1.8/34-36).
 *
 * Pet tipova stavki, jer svaki ima SVOJ ključ idempotencije i svoj način razrješenja sukoba:
 *
 *  - `site_diary`      — zaglavlje dana (vrijeme, opis, posjetioci, događaji, potpis);
 *  - `site_diary_item` — količina izvedenih radova (može dirati `project_boq_items`);
 *  - `hse_incident`    — prijava incidenta, **append-only**: druga prijava istog događaja je
 *                        DOPUNA, nikad prepisivanje (`HSE_INCIDENT_IMMUTABLE`);
 *  - `hse_action`      — korektivna mjera sa rokom i odgovornim;
 *  - `hse_training`    — obuka/toolbox sa potpisima prisutnih.
 *
 * Pravilo koje payload NE krši: telefon ne odlučuje šta je „sukob“. On šalje šta je čovjek vidio
 * i uradio; server upoređuje sa stanjem i, gdje sukob postoji, otvara `sync_conflicts`.
 * Za incident sukob NE POSTOJI — drugi zapis je drugi svjedok.
 */
import { isOffsetDateTime } from "./r4-sync-time";

const isBounded = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && value.trim().length >= min && value.trim().length <= max;

const isOptionalBounded = (value: unknown, max: number): boolean =>
  value === null || value === undefined || (typeof value === "string" && value.trim().length <= max);

const isDateOnly = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Decimalni broj sa najviše 3 decimale i tačkom (ne zarezom) — SQL `numeric` oblik. */
const isDecimal = (value: unknown, maxDecimals: number): value is string =>
  typeof value === "string" && new RegExp(`^\\d{1,14}(?:\\.\\d{1,${maxDecimals}})?$`).test(value);

/* ------------------------------------------------------------------ dnevnik */

export type DiaryWeather = "CLEAR" | "CLOUDY" | "RAIN" | "SNOW" | "WIND" | "FROST" | "HEAT";
export type DiaryDelayKind = "RAIN" | "SNOW" | "WIND" | "FROST" | "SUBCONTRACTOR" | "MATERIAL" | "PERMIT" | "OTHER";

export type R4DiaryDelayPayload = {
  kind: DiaryDelayKind;
  fromAt: string;
  toAt: string;
  hours: string;
  note: string | null;
};

export type R4SiteDiaryPayload = {
  projectId: string;
  diaryDate: string;
  weather: DiaryWeather | null;
  temperatureC: string | null;
  workedHours: string | null;
  description: string | null;
  visitors: string | null;
  events: string | null;
  signedName: string | null;
  delays: R4DiaryDelayPayload[];
};

export type R4SiteDiaryPushItem = {
  localId: string;
  entityType: "site_diary";
  /**
   * Identitet dnevnika je `(projekt, dan)` — unique u bazi. Telefon ga šalje da ponovni push
   * istog dana ne padne kao greška, nego kao `DUPLICATE`.
   */
  diaryId: string;
  deviceSentAt: string;
  /** `baseVersion` je verzija koju je šef vidio; razlika znači da je neko drugi mijenjao dan. */
  baseVersion: number;
  diary: R4SiteDiaryPayload;
};

const WEATHERS: readonly DiaryWeather[] = ["CLEAR", "CLOUDY", "RAIN", "SNOW", "WIND", "FROST", "HEAT"];
const DELAY_KINDS: readonly DiaryDelayKind[] = [
  "RAIN",
  "SNOW",
  "WIND",
  "FROST",
  "SUBCONTRACTOR",
  "MATERIAL",
  "PERMIT",
  "OTHER",
];

export function validSiteDiaryPayload(diary: R4SiteDiaryPayload): boolean {
  if (!diary || typeof diary !== "object") return false;
  if (!isBounded(diary.projectId, 1, 128)) return false;
  if (!isDateOnly(diary.diaryDate)) return false;
  if (diary.weather !== null && !WEATHERS.includes(diary.weather)) return false;
  if (diary.temperatureC !== null && !/^-?\d{1,3}(?:\.\d)?$/.test(diary.temperatureC)) return false;
  if (diary.workedHours !== null && !isDecimal(diary.workedHours, 2)) return false;
  if (!isOptionalBounded(diary.description, 4000)) return false;
  if (!isOptionalBounded(diary.visitors, 2000)) return false;
  if (!isOptionalBounded(diary.events, 4000)) return false;
  if (diary.signedName !== null && !isBounded(diary.signedName, 2, 200)) return false;
  if (!Array.isArray(diary.delays) || diary.delays.length > 20) return false;
  return diary.delays.every((delay) => {
    if (!delay || typeof delay !== "object") return false;
    if (!DELAY_KINDS.includes(delay.kind)) return false;
    if (!isOffsetDateTime(delay.fromAt) || !isOffsetDateTime(delay.toAt)) return false;
    if (Date.parse(delay.toAt) <= Date.parse(delay.fromAt)) return false;
    if (!isDecimal(delay.hours, 2)) return false;
    const hours = Number(delay.hours);
    if (!(hours > 0 && hours <= 24)) return false;
    return isOptionalBounded(delay.note, 1000);
  });
}

export function validSiteDiaryPushItem(item: R4SiteDiaryPushItem): boolean {
  if (!item || typeof item !== "object") return false;
  if (item.entityType !== "site_diary") return false;
  if (!isBounded(item.diaryId, 1, 128)) return false;
  if (!isOffsetDateTime(item.deviceSentAt)) return false;
  if (!Number.isInteger(item.baseVersion) || item.baseVersion < 1) return false;
  return validSiteDiaryPayload(item.diary);
}

export type R4SiteDiaryItemPayload = {
  /** NULL za rad koji nije u predmjeru — tada količina ne dira `project_boq_items`. */
  boqItemId: string | null;
  description: string;
  unit: string;
  quantity: string;
  source: "MANUAL" | "HAUL" | "BOQ";
};

export type R4SiteDiaryItemPushItem = {
  localId: string;
  entityType: "site_diary_item";
  diaryItemId: string;
  /** Poslovni ključ dnevnika, ne vrijeme slanja; opcionalno samo zbog starih redova. */
  diaryProjectId?: string;
  diaryDate?: string;
  deviceSentAt: string;
  item: R4SiteDiaryItemPayload;
};

export function validSiteDiaryItemPayload(item: R4SiteDiaryItemPayload): boolean {
  if (!item || typeof item !== "object") return false;
  if (item.boqItemId !== null && !isBounded(item.boqItemId, 1, 128)) return false;
  /* `BOQ` bez stavke predmjera nema gdje upisati količinu; `MANUAL`/`HAUL` je ne smiju imati. */
  if (item.source === "BOQ" && item.boqItemId === null) return false;
  if (item.source !== "BOQ" && item.boqItemId !== null) return false;
  if (!["MANUAL", "HAUL", "BOQ"].includes(item.source)) return false;
  if (!isBounded(item.description, 1, 500)) return false;
  if (!isBounded(item.unit, 1, 20)) return false;
  if (!isDecimal(item.quantity, 3)) return false;
  return Number(item.quantity) > 0;
}

export function validSiteDiaryItemPushItem(item: R4SiteDiaryItemPushItem): boolean {
  if (!item || typeof item !== "object") return false;
  if (item.entityType !== "site_diary_item") return false;
  if (!isBounded(item.diaryItemId, 1, 128)) return false;
  if ((item.diaryProjectId === undefined) !== (item.diaryDate === undefined)) return false;
  if (item.diaryProjectId !== undefined && !isBounded(item.diaryProjectId, 1, 128)) return false;
  if (item.diaryDate !== undefined && (!isDateOnly(item.diaryDate) || item.diaryDate.startsWith("0000-") ||
      Number.isNaN(Date.parse(`${item.diaryDate}T00:00:00Z`)) ||
      new Date(`${item.diaryDate}T00:00:00Z`).toISOString().slice(0, 10) !== item.diaryDate)) return false;
  if (!isOffsetDateTime(item.deviceSentAt)) return false;
  return validSiteDiaryItemPayload(item.item);
}

/* ------------------------------------------------------------------ HSE incident */

export type HseIncidentKindCode = "ACCIDENT" | "NEAR_MISS" | "PROPERTY_DAMAGE" | "ENVIRONMENTAL" | "OCCUPATIONAL_ILLNESS";
export type HseSeverityCode = "MINOR" | "MODERATE" | "SEVERE" | "FATAL";

export type R4HseIncidentPayload = {
  kind: HseIncidentKindCode;
  severity: HseSeverityCode;
  occurredAt: string;
  projectId: string | null;
  locationText: string | null;
  lat: string | null;
  lng: string | null;
  description: string;
  immediateAction: string | null;
  injuredWorkerId: string | null;
  lostDays: number;
  reportableToAuthority: boolean;
  /** Fotografije se šalju u drugom koraku (attachment-service), ali imena idu uz prijavu. */
  photos: {
    fileName: string;
    /** Isti spisak kao ugovor (`SyncPushItem`); ostalo se odbija prije upload-a. */
    contentType: "image/jpeg" | "image/png" | "image/webp" | "image/heic";
    sizeBytes: number;
    sha256: string;
  }[];
  /** Dopuna uz već postojeći incident (`null` = nova prijava). */
  updateBody: string | null;
};

export type R4HseIncidentPushItem = {
  localId: string;
  entityType: "hse_incident";
  incidentId: string;
  deviceSentAt: string;
  incident: R4HseIncidentPayload;
};

const INCIDENT_KINDS: readonly HseIncidentKindCode[] = [
  "ACCIDENT",
  "NEAR_MISS",
  "PROPERTY_DAMAGE",
  "ENVIRONMENTAL",
  "OCCUPATIONAL_ILLNESS",
];
const SEVERITIES: readonly HseSeverityCode[] = ["MINOR", "MODERATE", "SEVERE", "FATAL"];
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export function validHseIncidentPayload(incident: R4HseIncidentPayload): boolean {
  if (!incident || typeof incident !== "object") return false;
  if (!INCIDENT_KINDS.includes(incident.kind)) return false;
  if (!SEVERITIES.includes(incident.severity)) return false;
  if (!isOffsetDateTime(incident.occurredAt)) return false;
  if (incident.projectId !== null && !isBounded(incident.projectId, 1, 128)) return false;
  if (!isOptionalBounded(incident.locationText, 300)) return false;
  if (!isBounded(incident.description, 5, 4000)) return false;
  if (!isOptionalBounded(incident.immediateAction, 2000)) return false;
  if (!Number.isInteger(incident.lostDays) || incident.lostDays < 0 || incident.lostDays > 3650) return false;
  if (typeof incident.reportableToAuthority !== "boolean") return false;
  /* Koordinate idu u paru ili nikako — polovična lokacija je gora od nijedne. */
  const hasLat = incident.lat !== null;
  const hasLng = incident.lng !== null;
  if (hasLat !== hasLng) return false;
  if (hasLat && (!/^-?\d{1,3}(?:\.\d{1,6})?$/.test(incident.lat!) || !/^-?\d{1,3}(?:\.\d{1,6})?$/.test(incident.lng!))) {
    return false;
  }
  /* `NEAR_MISS` ne može nositi izgubljene dane ni povrijeđenog — to bi bio accident sa pogrešnom
     etiketom, a statistika bi lagala na obje strane. */
  if (incident.kind === "NEAR_MISS" && (incident.lostDays > 0 || incident.injuredWorkerId !== null)) return false;
  if (incident.injuredWorkerId !== null && !isBounded(incident.injuredWorkerId, 1, 128)) return false;
  if (!Array.isArray(incident.photos) || incident.photos.length > 10) return false;
  const photoOk = incident.photos.every(
    (photo) =>
      photo &&
      isBounded(photo.fileName, 1, 200) &&
      PHOTO_TYPES.includes(photo.contentType) &&
      Number.isInteger(photo.sizeBytes) &&
      photo.sizeBytes > 0 &&
      photo.sizeBytes <= 10_485_760 &&
      /^[0-9a-f]{64}$/.test(photo.sha256),
  );
  if (!photoOk) return false;
  return isOptionalBounded(incident.updateBody, 4000);
}

export function validHseIncidentPushItem(item: R4HseIncidentPushItem): boolean {
  if (!item || typeof item !== "object") return false;
  if (item.entityType !== "hse_incident") return false;
  /* `incidentId` je `localId` sa telefona; isti drugi put ne pravi drugi incident. */
  if (!isBounded(item.incidentId, 1, 128)) return false;
  if (!isOffsetDateTime(item.deviceSentAt)) return false;
  return validHseIncidentPayload(item.incident);
}

/* ------------------------------------------------------------------ HSE mjera */

export type R4HseActionPayload = {
  /** Tačno jedan izvor: incident ili inspekcija. */
  incidentId: string | null;
  inspectionId: string | null;
  description: string;
  responsibleWorkerId: string;
  dueOn: string;
};

export type R4HseActionPushItem = {
  localId: string;
  entityType: "hse_action";
  actionId: string;
  deviceSentAt: string;
  action: R4HseActionPayload;
};

export function validHseActionPayload(action: R4HseActionPayload): boolean {
  if (!action || typeof action !== "object") return false;
  const hasIncident = action.incidentId !== null;
  const hasInspection = action.inspectionId !== null;
  /* Mjera bez izvora nema gdje pripadati; sa oba izvora bi se brojala dvaput. */
  if (hasIncident === hasInspection) return false;
  if (hasIncident && !isBounded(action.incidentId, 1, 128)) return false;
  if (hasInspection && !isBounded(action.inspectionId, 1, 128)) return false;
  if (!isBounded(action.description, 5, 1000)) return false;
  /* Mjera bez odgovornog ili bez roka je zabilješka, ne mjera (spec §1.3/15). */
  if (!isBounded(action.responsibleWorkerId, 1, 128)) return false;
  return isDateOnly(action.dueOn);
}

export function validHseActionPushItem(item: R4HseActionPushItem): boolean {
  if (!item || typeof item !== "object") return false;
  if (item.entityType !== "hse_action") return false;
  if (!isBounded(item.actionId, 1, 128)) return false;
  if (!isOffsetDateTime(item.deviceSentAt)) return false;
  return validHseActionPayload(item.action);
}

/* ------------------------------------------------------------------ HSE obuka / toolbox */

export type R4HseTrainingPayload = {
  kind: "INDUCTION" | "TOOLBOX" | "TASK_INSTRUCTION" | "CERTIFICATION" | "DRILL";
  title: string;
  topic: string | null;
  heldAt: string;
  projectId: string | null;
  location: string | null;
  durationMinutes: number | null;
  /** Prisustvo je POTPIS: ime + vrijeme, po radniku. */
  attendees: { workerId: string; signatureName: string; signedAt: string }[];
};

export type R4HseTrainingPushItem = {
  localId: string;
  entityType: "hse_training";
  trainingId: string;
  deviceSentAt: string;
  training: R4HseTrainingPayload;
};

const TRAINING_KINDS = ["INDUCTION", "TOOLBOX", "TASK_INSTRUCTION", "CERTIFICATION", "DRILL"] as const;

export function validHseTrainingPayload(training: R4HseTrainingPayload): boolean {
  if (!training || typeof training !== "object") return false;
  if (!TRAINING_KINDS.includes(training.kind)) return false;
  if (!isBounded(training.title, 2, 200)) return false;
  if (!isOptionalBounded(training.topic, 1000)) return false;
  if (!isOffsetDateTime(training.heldAt)) return false;
  if (training.projectId !== null && !isBounded(training.projectId, 1, 128)) return false;
  if (!isOptionalBounded(training.location, 200)) return false;
  if (training.durationMinutes !== null) {
    if (!Number.isInteger(training.durationMinutes) || training.durationMinutes <= 0 || training.durationMinutes > 600) {
      return false;
    }
  }
  if (!Array.isArray(training.attendees) || training.attendees.length === 0 || training.attendees.length > 100) {
    return false;
  }
  const workers = new Set<string>();
  for (const attendee of training.attendees) {
    if (!attendee || typeof attendee !== "object") return false;
    if (!isBounded(attendee.workerId, 1, 128)) return false;
    /* Isti radnik dvaput je greška unosa, ne dva prisustva. */
    if (workers.has(attendee.workerId)) return false;
    workers.add(attendee.workerId);
    if (!isBounded(attendee.signatureName, 2, 200)) return false;
    if (!isOffsetDateTime(attendee.signedAt)) return false;
  }
  /* Toolbox bez teme nije obuka — to je „sastanak“ bez zapisa o čemu. */
  if (training.kind === "TOOLBOX" && (training.topic === null || training.topic.trim().length < 3)) return false;
  return true;
}

export function validHseTrainingPushItem(item: R4HseTrainingPushItem): boolean {
  if (!item || typeof item !== "object") return false;
  if (item.entityType !== "hse_training") return false;
  if (!isBounded(item.trainingId, 1, 128)) return false;
  if (!isOffsetDateTime(item.deviceSentAt)) return false;
  return validHseTrainingPayload(item.training);
}
