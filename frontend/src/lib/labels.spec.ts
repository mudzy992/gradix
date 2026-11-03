import { describe, expect, it } from 'vitest'
import {
  KNOWN_STATUSES,
  assignmentRole,
  formatDuration,
  formatHours,
  gpsSource,
  machineStatus,
  machineType,
  materialUnit,
  projectStatus,
  taskPriority,
  taskStatus,
  tripStatusOf,
} from '@/lib/labels'

/**
 * FE-08 — mape enuma. Test drži dvije stvari: (1) pokriveni su **svi** statusi iz Prisma šeme
 * (`backend/prisma/schema/ops.prisma`), pa se novi enum ne može tiho prikazati sirov korisniku,
 * i (2) boja badge-a nosi značenje (hitno/otkazano crveno, u toku primarno).
 */
describe('mape statusa', () => {
  it('pokrivaju sve statuse iz šeme', () => {
    expect(KNOWN_STATUSES.project).toEqual(['PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'])
    expect(KNOWN_STATUSES.task).toEqual([
      'PENDING',
      'ASSIGNED',
      'IN_PROGRESS',
      'PAUSED',
      'COMPLETED',
      'CANCELLED',
    ])
    expect(KNOWN_STATUSES.priority).toEqual(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
    expect(KNOWN_STATUSES.role).toEqual(['PM', 'SS', 'WORKER', 'DRIVER', 'OP'])
  })

  it('vraća i18n ključ i ton za poznate vrijednosti', () => {
    expect(projectStatus('IN_PROGRESS')).toEqual({
      labelKey: 'status.project.IN_PROGRESS',
      tone: 'default',
      known: true,
    })
    expect(taskStatus('CANCELLED').tone).toBe('destructive')
    expect(taskPriority('URGENT').tone).toBe('destructive')
    expect(taskPriority('LOW').tone).toBe('outline')
    expect(assignmentRole('PM').labelKey).toBe('status.role.PM')
  })

  it('nepoznat enum ne puca: ključ postoji, `known` je false, ton je neutralan', () => {
    const meta = taskStatus('NEKI_NOVI_STATUS')
    expect(meta).toEqual({
      labelKey: 'status.task.NEKI_NOVI_STATUS',
      tone: 'outline',
      known: false,
    })
  })
})

describe('formatDuration()', () => {
  it('ispod sat vremena prikazuje samo minute', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(59)).toBe('59 min')
  })

  it('pune sate prikazuje bez minuta, a ostatak uz sate', () => {
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(120)).toBe('2 h')
    expect(formatDuration(95)).toBe('1 h 35 min')
    expect(formatDuration(1500)).toBe('25 h')
  })

  it('prazna vrijednost je crtica, a negativno se ne prikazuje kao negativno', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(undefined)).toBe('—')
    expect(formatDuration(-5)).toBe('0 min')
  })
})

/**
 * FE-09 — flota i logistika. Isti ugovor kao za projekte/zadatke: skup vrijednosti mora prattiti
 * `backend/prisma/schema/fleet.prisma`, pa novi tip mašine ili jedinica ne može tiho iskočiti
 * korisniku kao `EXCAVATOR` ili `M3`.
 */
describe('mape flote i logistike', () => {
  it('pokrivaju sve vrijednosti iz šeme', () => {
    expect(KNOWN_STATUSES.machine).toEqual(['IDLE', 'ACTIVE', 'IN_SERVICE', 'DECOMMISSIONED'])
    expect(KNOWN_STATUSES.machineType).toEqual([
      'TRUCK',
      'EXCAVATOR',
      'LOADER',
      'GRADER',
      'ROLLER',
      'PAVER',
      'DUMPER',
      'COMPRESSOR',
      'OTHER',
    ])
    expect(KNOWN_STATUSES.gps).toEqual(['PHONE', 'IOT'])
    expect(KNOWN_STATUSES.unit).toEqual(['M3', 'T', 'M', 'M2', 'PCS', 'H', 'L'])
    expect(KNOWN_STATUSES.trip).toEqual(['LOADED', 'UNLOADED'])
  })

  it('ton badge-a nosi značenje: rashodovana je crvena, na servisu neutralna', () => {
    expect(machineStatus('DECOMMISSIONED').tone).toBe('destructive')
    expect(machineStatus('IN_SERVICE').tone).toBe('secondary')
    expect(machineStatus('ACTIVE').tone).toBe('default')
    expect(machineType('EXCAVATOR')).toEqual({
      labelKey: 'status.machineType.EXCAVATOR',
      tone: 'outline',
      known: true,
    })
    expect(gpsSource('IOT').labelKey).toBe('status.gps.IOT')
    expect(materialUnit('M3').labelKey).toBe('status.unit.M3')
  })

  it('nepoznat tip mašine ne puca (known: false)', () => {
    expect(machineType('DRONE')).toEqual({
      labelKey: 'status.machineType.DRONE',
      tone: 'outline',
      known: false,
    })
  })

  it('status ture se izvodi iz `unloadedAt`', () => {
    expect(tripStatusOf({ unloadedAt: null }).labelKey).toBe('status.trip.LOADED')
    expect(tripStatusOf({ unloadedAt: '2026-11-03T09:00:00.000Z' }).labelKey).toBe('status.trip.UNLOADED')
    expect(tripStatusOf({ unloadedAt: '2026-11-03T09:00:00.000Z' }).tone).toBe('default')
  })
})

describe('formatHours()', () => {
  it('Decimal string pretvara u sate sa zarezom i tačkom za hiljade', () => {
    expect(formatHours('1234.500')).toBe('1.234,5 h')
    expect(formatHours('12.000')).toBe('12 h')
    expect(formatHours(0)).toBe('0 h')
    expect(formatHours('0.250')).toBe('0,3 h')
  })

  it('prazna ili neispravna vrijednost je crtica', () => {
    expect(formatHours(null)).toBe('—')
    expect(formatHours(undefined)).toBe('—')
    expect(formatHours('nije broj')).toBe('—')
  })
})
