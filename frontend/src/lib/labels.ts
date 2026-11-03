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

/** Vrijednosti koje backend šalje — izloženo za testove (mapa i šema ne smiju se razići). */
export const KNOWN_STATUSES = {
  project: Object.keys(PROJECT_STATUS),
  task: Object.keys(TASK_STATUS),
  priority: Object.keys(TASK_PRIORITY),
  role: Object.keys(ASSIGNMENT_ROLE),
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
