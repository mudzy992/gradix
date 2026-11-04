/**
 * FE-08 — prevodi i tonovi za enume koje backend vraća.
 *
 * Zašto poseban modul: `projects`, `tasks`, `fleet`, `logistics` i `payroll` prikazuju iste enume
 * (`PENDING`, `IN_PROGRESS`, `URGENT`…) na više ekrana. Dok su se prikazivali **sirovi** (velikim
 * slovima, na engleskom) interfejs je bio polovično preveden, a boja badge-a nije nosila značenje.
 * Ovako jedno mjesto određuje i tekst (i18n ključ) i ton (`Badge` varijantu), pa se ne mogu razići.
 */

/** Isti skup vrijednosti kao `badgeVariants` (`components/ui/badge.tsx`). */
export type BadgeTone = 'default' | 'secondary' | 'destructive' | 'outline'

export type StatusMeta = {
  /** i18n ključ; ako enum nije poznat, ključ ne postoji i komponenta prikazuje sirovu vrijednost. */
  labelKey: string
  tone: BadgeTone
  known: boolean
}

type Entry = { tone: BadgeTone }

const PROJECT_STATUS: Record<string, Entry> = {
  PLANNING: { tone: 'outline' },
  IN_PROGRESS: { tone: 'default' },
  ON_HOLD: { tone: 'secondary' },
  COMPLETED: { tone: 'secondary' },
  CANCELLED: { tone: 'destructive' },
}

const TASK_STATUS: Record<string, Entry> = {
  PENDING: { tone: 'outline' },
  ASSIGNED: { tone: 'secondary' },
  IN_PROGRESS: { tone: 'default' },
  PAUSED: { tone: 'secondary' },
  COMPLETED: { tone: 'secondary' },
  CANCELLED: { tone: 'destructive' },
}

const TASK_PRIORITY: Record<string, Entry> = {
  LOW: { tone: 'outline' },
  MEDIUM: { tone: 'secondary' },
  HIGH: { tone: 'default' },
  URGENT: { tone: 'destructive' },
}

const MACHINE_STATUS: Record<string, Entry> = {
  IDLE: { tone: 'outline' },
  ACTIVE: { tone: 'default' },
  IN_SERVICE: { tone: 'secondary' },
  DECOMMISSIONED: { tone: 'destructive' },
}

/** Tip mašine nije stanje — sve vrijednosti nose isti, neutralan ton. */
const MACHINE_TYPE: Record<string, Entry> = {
  TRUCK: { tone: 'outline' },
  EXCAVATOR: { tone: 'outline' },
  LOADER: { tone: 'outline' },
  GRADER: { tone: 'outline' },
  ROLLER: { tone: 'outline' },
  PAVER: { tone: 'outline' },
  DUMPER: { tone: 'outline' },
  COMPRESSOR: { tone: 'outline' },
  OTHER: { tone: 'outline' },
}

const GPS_SOURCE: Record<string, Entry> = {
  PHONE: { tone: 'secondary' },
  IOT: { tone: 'default' },
}

/** Jedinica mjere iz šeme (`MaterialUnit`); `M3`/`M2` se prikazuju kao m³/m². */
const MATERIAL_UNIT: Record<string, Entry> = {
  M3: { tone: 'outline' },
  T: { tone: 'outline' },
  M: { tone: 'outline' },
  M2: { tone: 'outline' },
  PCS: { tone: 'outline' },
  H: { tone: 'outline' },
  L: { tone: 'outline' },
}

/** Tura nije status u bazi: izvodi se iz `unloadedAt` (FE-09). */
const TRIP_STATUS: Record<string, Entry> = {
  LOADED: { tone: 'secondary' },
  UNLOADED: { tone: 'default' },
}

const HSE_SEVERITY: Record<string, Entry> = {
  LOW: { tone: 'outline' },
  MEDIUM: { tone: 'secondary' },
  HIGH: { tone: 'destructive' },
}

const HSE_STATUS: Record<string, Entry> = {
  OPEN: { tone: 'default' },
  ACK: { tone: 'secondary' },
  CLOSED: { tone: 'outline' },
}

const TENDER_STATUS: Record<string, Entry> = {
  DRAFT: { tone: 'outline' },
  SUBMITTED: { tone: 'default' },
  WON: { tone: 'secondary' },
  LOST: { tone: 'destructive' },
  WITHDRAWN: { tone: 'outline' },
}

const SERVICE_STATUS: Record<string, Entry> = {
  PLANNED: { tone: 'outline' },
  SCHEDULED: { tone: 'secondary' },
  IN_PROGRESS: { tone: 'default' },
  COMPLETED: { tone: 'secondary' },
  CANCELLED: { tone: 'destructive' },
}

const ASSIGNMENT_ROLE: Record<string, Entry> = {
  PM: { tone: 'default' },
  SS: { tone: 'default' },
  WORKER: { tone: 'secondary' },
  DRIVER: { tone: 'secondary' },
  OP: { tone: 'secondary' },
}

function meta(map: Record<string, Entry>, group: string, value: string): StatusMeta {
  const entry = map[value]
  return {
    labelKey: `status.${group}.${value}`,
    tone: entry?.tone ?? 'outline',
    known: Boolean(entry),
  }
}

export const projectStatus = (value: string): StatusMeta => meta(PROJECT_STATUS, 'project', value)
export const taskStatus = (value: string): StatusMeta => meta(TASK_STATUS, 'task', value)
export const taskPriority = (value: string): StatusMeta => meta(TASK_PRIORITY, 'priority', value)
export const assignmentRole = (value: string): StatusMeta => meta(ASSIGNMENT_ROLE, 'role', value)
export const machineStatus = (value: string): StatusMeta => meta(MACHINE_STATUS, 'machine', value)
export const machineType = (value: string): StatusMeta => meta(MACHINE_TYPE, 'machineType', value)
export const gpsSource = (value: string): StatusMeta => meta(GPS_SOURCE, 'gps', value)
export const materialUnit = (value: string): StatusMeta => meta(MATERIAL_UNIT, 'unit', value)
export const tripStatus = (value: string): StatusMeta => meta(TRIP_STATUS, 'trip', value)
export const hseSeverity = (value: string): StatusMeta => meta(HSE_SEVERITY, 'hseSeverity', value)
export const hseStatus = (value: string): StatusMeta => meta(HSE_STATUS, 'hseStatus', value)
export const tenderStatus = (value: string): StatusMeta => meta(TENDER_STATUS, 'tender', value)
export const serviceStatus = (value: string): StatusMeta => meta(SERVICE_STATUS, 'service', value)

/** Tura je „istovarena“ kad ima `unloadedAt`; jedino mjesto gdje se to pravilo zna. */
export const tripStatusOf = (row: { unloadedAt: string | null }): StatusMeta =>
  tripStatus(row.unloadedAt ? 'UNLOADED' : 'LOADED')

/** Vrijednosti koje backend šalje — izloženo za testove (mapa i šema ne smiju se razići). */
export const KNOWN_STATUSES = {
  project: Object.keys(PROJECT_STATUS),
  task: Object.keys(TASK_STATUS),
  priority: Object.keys(TASK_PRIORITY),
  role: Object.keys(ASSIGNMENT_ROLE),
  machine: Object.keys(MACHINE_STATUS),
  machineType: Object.keys(MACHINE_TYPE),
  gps: Object.keys(GPS_SOURCE),
  unit: Object.keys(MATERIAL_UNIT),
  trip: Object.keys(TRIP_STATUS),
  hseSeverity: Object.keys(HSE_SEVERITY),
  hseStatus: Object.keys(HSE_STATUS),
  tender: Object.keys(TENDER_STATUS),
  service: Object.keys(SERVICE_STATUS),
}

/**
 * Minute → čitljivo trajanje („1 h 25 min“). Satnica se računa u minutama, a korisniku je
 * „95 min“ besmisleno; ispod sat vremena ostaje samo `min`.
 */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) {
    return '—'
  }
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (hours === 0) {
    return `${rest} min`
  }
  if (rest === 0) {
    return `${hours} h`
  }
  return `${hours} h ${rest} min`
}

/**
 * Sati rada mašine (`Decimal(12,3)`, stiže kao string) → „1.234,5 h“.
 *
 * Zašto ne `Number(...).toLocaleString('bs-BA')`: ICU u CI image-u i na vlasnikovom računaru ne mora
 * dati isti separator, a test bi postao zavisan od okruženja. Zato je formatiranje ručno i
 * deterministički: hiljade tačkom, decimale zarezom, maksimalno jedna decimala, bez „,0“.
 */
export function formatHours(value: string | number | null | undefined): string {
  const raw = typeof value === 'string' ? Number(value.replace(',', '.')) : value
  if (raw === null || raw === undefined || !Number.isFinite(Number(raw))) {
    return '—'
  }
  const hours = Math.max(0, Number(raw))
  const rounded = Math.round(hours * 10) / 10
  const [whole, decimal] = rounded.toFixed(1).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return decimal && decimal !== '0' ? `${grouped},${decimal} h` : `${grouped} h`
}

/** Pragovi iz `docs/` (D-013): upozorenja na 30 / 15 / 5 dana prije isteka dokumenta. */
export const EXPIRY_WARN_DAYS = [30, 15, 5] as const

/** Broj dana do datuma (negativno = prošlo); `null` kad datuma nema ili nije ispravan. */
export function daysUntil(date: string | null | undefined, now: Date = new Date()): number | null {
  if (!date) {
    return null
  }
  const target = new Date(date)
  if (Number.isNaN(target.getTime())) {
    return null
  }
  const day = 24 * 60 * 60 * 1000
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const end = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate())
  return Math.round((end - start) / day)
}

/**
 * Stanje dokumenta za prikaz. Prije ovoga je ekran dokumenata prikazivao samo datum, iako sam
 * tekst kaže „Upozorenja 30 / 15 / 5 dana“ — korisnik je morao sam računati da li je nešto isteklo.
 */
export function documentState(expiresAt: string | null | undefined, now: Date = new Date()): StatusMeta {
  const days = daysUntil(expiresAt, now)
  if (days === null) {
    return { labelKey: 'status.doc.none', tone: 'outline', known: true }
  }
  if (days < 0) {
    return { labelKey: 'status.doc.expired', tone: 'destructive', known: true }
  }
  if (days <= EXPIRY_WARN_DAYS[0]) {
    return { labelKey: 'status.doc.expiring', tone: 'default', known: true }
  }
  return { labelKey: 'status.doc.valid', tone: 'secondary', known: true }
}

/**
 * Novac/iznos (`Decimal` string) → „12.500,00“. Bez ovoga su tenderski ekrani prikazivali
 * „12000.00 vs 15230.50“ — tačka kao decimalni znak i bez razdvajanja hiljada.
 */
export function formatAmount(value: string | number | null | undefined): string {
  const raw = typeof value === 'string' ? Number(value.replace(',', '.')) : value
  if (raw === null || raw === undefined || !Number.isFinite(Number(raw))) {
    return '—'
  }
  const [whole, decimal] = Math.abs(Number(raw)).toFixed(2).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${Number(raw) < 0 ? '-' : ''}${grouped},${decimal}`
}
