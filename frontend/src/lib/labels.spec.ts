import { describe, expect, it } from 'vitest'
import {
  KNOWN_STATUSES,
  assignmentRole,
  formatDuration,
  projectStatus,
  taskPriority,
  taskStatus,
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
