import type { PhaseRow, TaskRow } from '@/lib/ops-types'

type Item = { id: string; name: string; start: string; end: string; startTime: number; endTime: number }

function toTime(value: string): number | null {
  const prefix = value.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(prefix)) return null
  const calendar = new Date(`${prefix}T00:00:00.000Z`)
  if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== prefix) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function toItem(id: string, name: string, start: string | null, end: string | null): Item | null {
  if (!start || !end) return null
  const startTime = toTime(start)
  const endTime = toTime(end)
  if (startTime === null || endTime === null || endTime < startTime) return null
  return { id, name, start, end, startTime, endTime }
}

export function PlannedGantt({ phases, tasks }: { phases: PhaseRow[]; tasks: TaskRow[] }) {
  const items = [
    ...phases.map((phase) => toItem(`phase-${phase.id}`, phase.name, phase.plannedStart, phase.plannedEnd)),
    ...tasks.map((task) => toItem(`task-${task.id}`, task.title, task.plannedStart, task.plannedEnd)),
  ].filter((item): item is Item => item !== null)
  if (items.length === 0) return null

  const min = Math.min(...items.map((item) => item.startTime))
  const max = Math.max(...items.map((item) => item.endTime))
  const span = Math.max(max - min, 1)
  return (
    <div className="grid gap-2">
      {items.map((item) => {
        const left = Math.min(((item.startTime - min) / span) * 100, 98)
        const width = Math.min(Math.max(((item.endTime - item.startTime) / span) * 100, 2), 100 - left)
        return (
          <div key={item.id} className="grid gap-1">
            <p className="text-xs text-muted-foreground">
              {item.name}: <time dateTime={item.start}>{item.start.slice(0, 10)}</time> –{' '}
              <time dateTime={item.end}>{item.end.slice(0, 10)}</time>
            </p>
            <div className="relative h-6 rounded-md bg-secondary" aria-hidden="true">
              <div className="absolute inset-y-0 rounded-md bg-primary/80" style={{ left: `${left}%`, width: `${width}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
