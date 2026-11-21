import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PhaseRow, TaskRow } from '@/lib/ops-types'
import { PlannedGantt } from './planned-gantt'

const phase = (values: Partial<PhaseRow>) => ({ id: 'same-id', name: 'Temelji', plannedStart: null, plannedEnd: null, ...values }) as PhaseRow
const task = (values: Partial<TaskRow>) => ({ id: 'same-id', title: 'Iskop', plannedStart: null, plannedEnd: null, ...values }) as TaskRow

describe('PlannedGantt', () => {
  it('renders date ranges as readable text and hides decorative bars from assistive technology', () => {
    const { container } = render(<PlannedGantt phases={[phase({ plannedStart: '2026-03-01', plannedEnd: '2026-03-10' })]} tasks={[task({ plannedStart: '2026-03-10', plannedEnd: '2026-03-10' })]} />)
    expect(screen.getByText('Temelji:', { exact: false })).toHaveTextContent('2026-03-01 – 2026-03-10')
    expect(screen.getByText('Iskop:', { exact: false })).toHaveTextContent('2026-03-10 – 2026-03-10')
    const bars = container.querySelectorAll('[aria-hidden="true"]')
    expect(bars).toHaveLength(2)
    const lastBar = bars[1].firstElementChild as HTMLElement
    expect(lastBar.style.left).toBe('98%')
    expect(lastBar.style.width).toBe('2%')
  })

  it('ignores missing, malformed or inverted ranges instead of producing misleading bars', () => {
    const { container } = render(<PlannedGantt phases={[
      phase({ plannedStart: 'invalid', plannedEnd: '2026-03-10' }),
      phase({ id: 'inverted', plannedStart: '2026-03-11', plannedEnd: '2026-03-10' }),
      phase({ id: 'overflow', plannedStart: '2026-02-31', plannedEnd: '2026-03-10' }),
    ]} tasks={[task({ plannedStart: null, plannedEnd: '2026-03-10' })]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
