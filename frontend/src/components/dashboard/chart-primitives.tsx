import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export type DataPoint = { label: string; value: number | null }
type ChartProps = { label: string; values: DataPoint[]; emptyLabel: string; tableLabel: string }
const valid = (value: number | null): value is number => value !== null && Number.isFinite(value)

function DataTable({ label, values, tableLabel }: Pick<ChartProps, 'label' | 'values' | 'tableLabel'>) {
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">{tableLabel}</summary>
      <table className="mt-2 w-full text-left">
        <caption className="sr-only">{label}</caption>
        <tbody>{values.map((point, index) => (
          <tr key={`${point.label}-${index}`}><th scope="row" className="pr-4 font-normal">{point.label}</th><td className="text-right tabular-nums">{valid(point.value) ? point.value : '—'}</td></tr>
        ))}</tbody>
      </table>
    </details>
  )
}

export function Sparkline({ label, values, emptyLabel, tableLabel }: ChartProps) {
  const nums = values.flatMap((p) => valid(p.value) ? [p.value] : [])
  const min = nums.length ? Math.min(...nums) : 0
  const max = nums.length ? Math.max(...nums) : 0
  const scale = Math.max(1, Math.abs(min), Math.abs(max))
  const scaledMin = min / scale
  const range = max / scale - scaledMin
  const points = values.map((p, i) => valid(p.value) ? {
    x: values.length <= 1 ? 120 : 4 + (i / (values.length - 1)) * 232,
    y: range === 0 ? 40 : 72 - ((p.value / scale - scaledMin) / range) * 64,
  } : null)
  const segments: Array<Array<{ x: number; y: number }>> = []
  let current: Array<{ x: number; y: number }> = []
  for (const point of points) {
    if (point) current.push(point)
    else if (current.length) { segments.push(current); current = [] }
  }
  if (current.length) segments.push(current)
  return (
    <figure className="grid gap-2">
      <figcaption className="sr-only">{label}</figcaption>
      {nums.length === 0 ? <p className="text-sm text-muted-foreground">{emptyLabel}</p> : (
        <svg viewBox="0 0 240 80" aria-hidden="true" className="h-16 w-full overflow-visible text-accent">
          {segments.map((segment, index) => segment.length === 1
            ? <circle key={index} cx={segment[0].x} cy={segment[0].y} r="3" fill="currentColor" />
            : <polyline key={index} points={segment.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />)}
        </svg>
      )}
      {values.length > 0 && <DataTable label={label} values={values} tableLabel={tableLabel} />}
    </figure>
  )
}

export function BarChart({ label, values, emptyLabel, tableLabel }: ChartProps) {
  const nums = values.flatMap((p) => valid(p.value) ? [p.value] : [])
  const min = Math.min(0, ...nums)
  const max = Math.max(0, ...nums)
  const scale = Math.max(1, Math.abs(min), Math.abs(max))
  const scaledMin = min / scale
  const range = max / scale - scaledMin || 1
  const zero = 72 - ((0 - scaledMin) / range) * 64
  const step = 232 / Math.max(values.length, 1)
  return (
    <figure className="grid gap-2">
      <figcaption className="sr-only">{label}</figcaption>
      {nums.length === 0 ? <p className="text-sm text-muted-foreground">{emptyLabel}</p> : (
        <svg viewBox="0 0 240 80" aria-hidden="true" className="h-20 w-full text-accent">
          {values.map((point, index) => {
            if (!valid(point.value)) return null
            const y = 72 - ((point.value / scale - scaledMin) / range) * 64
            return <rect key={index} x={4 + index * step} y={Math.min(y, zero)} width={Math.max(1, step * 0.72)} height={Math.max(1, Math.abs(y - zero))} rx="1" fill="currentColor" />
          })}
        </svg>
      )}
      {values.length > 0 && <DataTable label={label} values={values} tableLabel={tableLabel} />}
    </figure>
  )
}

export function ProgressBar({ label, value, max, unavailableLabel, statusLabels }: { label: string; value: number | null; max: number | null; unavailableLabel: string; statusLabels: { normal: string; warning: string; critical: string } }) {
  if (!valid(value) || !valid(max) || max <= 0 || value < 0) return <div className="text-sm"><span>{label}: </span><span className="text-muted-foreground">{unavailableLabel}</span></div>
  const percent = Math.round((value / max) * 100)
  if (!Number.isFinite(percent)) return <div className="text-sm"><span>{label}: </span><span className="text-muted-foreground">{unavailableLabel}</span></div>
  const status = percent >= 100 ? statusLabels.critical : percent >= 80 ? statusLabels.warning : statusLabels.normal
  const bounded = Math.min(100, Math.max(0, percent))
  const color = percent >= 100 ? 'bg-destructive' : percent >= 80 ? 'bg-warning' : 'bg-success'
  return (
    <div className="grid gap-1">
      <div className="flex justify-between gap-3 text-sm"><span>{label}</span><span><span className="tabular-nums">{percent}%</span> <span>· {status}</span></span></div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bounded} aria-valuetext={`${percent}% — ${status}`} className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${bounded}%` }} />
      </div>
    </div>
  )
}

export function Donut({ label, values, emptyLabel, tableLabel }: ChartProps) {
  const complete = values.length <= 4 && values.every((point) => valid(point.value) && point.value >= 0)
  const raw = values.map((point) => valid(point.value) && point.value > 0 ? point.value : 0)
  const scale = Math.max(0, ...raw)
  const safe = raw.map((value) => scale > 0 ? value / scale : 0)
  const total = complete ? safe.reduce((a, b) => a + b, 0) : 0
  const circumference = 2 * Math.PI * 36
  const colors = ['var(--primary)', 'var(--accent)', 'var(--warning)', 'var(--muted-foreground)']
  let offset = 0
  return (
    <figure className="grid gap-2">
      <figcaption className="sr-only">{label}</figcaption>
      {total <= 0 ? <p className="text-sm text-muted-foreground">{emptyLabel}</p> : (
        <svg viewBox="0 0 100 100" aria-hidden="true" className="h-24 w-24 -rotate-90">
          {safe.map((value, index) => {
            const length = circumference * value / total
            const start = offset
            offset += length
            return value > 0 ? <circle key={index} cx="50" cy="50" r="36" fill="none" stroke={colors[index % colors.length]} strokeWidth="12" strokeDasharray={`${length} ${circumference}`} strokeDashoffset={-start} /> : null
          })}
        </svg>
      )}
      {values.length > 0 && <ul className="grid gap-1 text-sm">{values.map((point, index) => (
        <li key={`${point.label}-${index}`} className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: colors[index % colors.length] }} />
          <span>{point.label}</span><span className="ml-auto tabular-nums">{valid(point.value) ? point.value : '—'}</span>
        </li>
      ))}</ul>}
      {values.length > 0 && <DataTable label={label} values={values} tableLabel={tableLabel} />}
    </figure>
  )
}

export function CountUp({ value, locale }: { value: number; locale: string }) {
  const [display, setDisplay] = useState(() => {
    const media = typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-reduced-motion: reduce)')
    return media && !media.matches && typeof window.requestAnimationFrame === 'function' ? 0 : value
  })
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!Number.isFinite(value) || !media || media.matches || typeof window.requestAnimationFrame !== 'function') { setDisplay(value); return }
    let frame = 0
    const start = performance.now()
    const duration = 450
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / duration))
      setDisplay(value * (1 - (1 - progress) ** 3))
      if (progress < 1) frame = window.requestAnimationFrame(tick)
    }
    const reduce = () => { if (media.matches) { window.cancelAnimationFrame(frame); setDisplay(value) } }
    media.addEventListener('change', reduce)
    frame = window.requestAnimationFrame(tick)
    return () => { window.cancelAnimationFrame(frame); media.removeEventListener('change', reduce) }
  }, [value])
  return <span>{Number.isFinite(display) ? new Intl.NumberFormat(locale, { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(display) : '—'}</span>
}

export function Skeleton({ label, className }: { label: string; className?: string }) {
  return <div role="status" aria-label={label} className={cn('dashboard-skeleton rounded-md', className)} />
}
