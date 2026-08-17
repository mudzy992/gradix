import type { PhaseRow, TaskRow } from '@/lib/ops-types'

type Item = { id: string; name: string; start: string | null; end: string | null }

function toTime(value: string | null): number | null {
  if (!value) {
    return null
  }
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

export function PlannedGantt({ phases, tasks }: { phases: PhaseRow[]; tasks: TaskRow[] }) {
  const items: Item[] = [
    ...phases.map((phase) => ({ id: phase.id, name: phase.name, start: phase.plannedStart, end: phase.plannedEnd })),
    ...tasks.map((task) => ({ id: task.id, name: task.title, start: task.plannedStart, end: task.plannedEnd })),
  ].filter((item) => item.start && item.end)
  if (items.length === 0) {
    return null
  }
  const starts = items.map((item) => toTime(item.start) as number)
  const ends = items.map((item) => toTime(item.end) as number)
  const min = Math.min(...starts)
  const max = Math.max(...ends)
  const span = Math.max(max - min, 1)
  return (
    <div className="grid gap-2">
      {items.map((item) => {
        const start = toTime(item.start) as number
        const end = toTime(item.end) as number
        const left = ((start - min) / span) * 100
        const width = Math.max(((end - start) / span) * 100, 2)
        return (
          <div key={item.id} className="grid gap-1">
            <p className="text-xs text-muted-foreground">{item.name}</p>
            <div className="relative h-6 rounded-md bg-secondary">
              <div
                className="absolute inset-y-0 rounded-md bg-primary/80"
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
