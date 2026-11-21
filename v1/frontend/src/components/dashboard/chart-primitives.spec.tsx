import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BarChart, CountUp, Donut, ProgressBar, Skeleton, Sparkline } from './chart-primitives'

const points = [{ label: 'Mon', value: 0 }, { label: 'Tue', value: null }, { label: 'Wed', value: 5 }]
describe('dashboard primitives', () => {
  it('gives charts a text table and does not join across missing samples', () => {
    const { container } = render(<Sparkline label="Trend" values={points} emptyLabel="No data" tableLabel="Show data" />)
    expect(screen.getByText('Show data')).toBeInTheDocument()
    expect(screen.getByText('Tue')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelectorAll('polyline')).toHaveLength(0)
  })
  it('distinguishes no samples from a genuine zero and supports negative bars', () => {
    const { rerender, container } = render(<BarChart label="Hours" values={[]} emptyLabel="No data" tableLabel="Show data" />)
    expect(screen.getByText('No data')).toBeInTheDocument()
    rerender(<BarChart label="Hours" values={[{ label: 'A', value: 0 }, { label: 'B', value: -2 }]} emptyLabel="No data" tableLabel="Show data" />)
    expect(screen.queryByText('No data')).not.toBeInTheDocument()
    expect(container.querySelectorAll('rect')).toHaveLength(2)
    expect(screen.getByText('-2')).toBeInTheDocument()
  })
  it('shows progress thresholds, preserves overrun text and handles unavailable denominators', () => {
    const { rerender } = render(<ProgressBar label="Budget" value={120} max={100} unavailableLabel="Not available" statusLabels={{ normal: 'Normal', warning: 'Warning', critical: 'Critical' }} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '120% — Critical')
    expect(screen.getByText('120%')).toBeInTheDocument()
    rerender(<ProgressBar label="Budget" value={0} max={0} unavailableLabel="Not available" statusLabels={{ normal: 'Normal', warning: 'Warning', critical: 'Critical' }} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByText('Not available')).toBeInTheDocument()
  })
  it('does not promote a value below a threshold because of display rounding', () => {
    const { rerender } = render(<ProgressBar label="Budget" value={79.99} max={100} unavailableLabel="Not available" statusLabels={{ normal: 'Normal', warning: 'Warning', critical: 'Critical' }} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '79.99% — Normal')
    rerender(<ProgressBar label="Budget" value={99.99} max={100} unavailableLabel="Not available" statusLabels={{ normal: 'Normal', warning: 'Warning', critical: 'Critical' }} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '99.99% — Warning')
  })
  it('keeps donut values readable when total is zero', () => {
    render(<Donut label="Split" values={[{ label: 'A', value: 0 }, { label: 'B', value: 0 }]} emptyLabel="No data" tableLabel="Show data" />)
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.getAllByText('A')).toHaveLength(2)
    expect(screen.getAllByText('0')).toHaveLength(4)
  })
  it('respects reduced motion for count-up and exposes skeleton loading state', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    render(<><CountUp value={42} locale="en" /><Skeleton label="Loading" /></>)
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading')
    vi.unstubAllGlobals()
  })
  it('never draws a misleading partial donut when a value is missing or negative', () => {
    const { container, rerender } = render(<Donut label="Split" values={[{ label: 'A', value: 5 }, { label: 'B', value: null }]} emptyLabel="No data" tableLabel="Show data" />)
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
    rerender(<Donut label="Split" values={[{ label: 'A', value: 5 }, { label: 'B', value: -1 }]} emptyLabel="No data" tableLabel="Show data" />)
    expect(container.querySelector('svg')).toBeNull()
  })
  it('handles a flat sparkline and reveals the values, including zero', () => {
    const { container } = render(<Sparkline label="Trend" values={[{ label: 'A', value: 0 }, { label: 'B', value: 0 }]} emptyLabel="No data" tableLabel="Show data" />)
    expect(screen.queryByText('No data')).not.toBeInTheDocument()
    expect(container.querySelector('polyline')?.getAttribute('points')).toBe('4,40 236,40')
  })
  it('uses warning and danger tokens without relying on color alone', () => {
    const { rerender } = render(<ProgressBar label="Budget" value={85} max={100} unavailableLabel="Not available" statusLabels={{ normal: 'Normal', warning: 'Warning', critical: 'Critical' }} />)
    expect(screen.getByText('85%')).toBeVisible()
    expect(screen.getByRole('progressbar').firstElementChild).toHaveClass('bg-warning')
    rerender(<ProgressBar label="Budget" value={101} max={100} unavailableLabel="Not available" statusLabels={{ normal: 'Normal', warning: 'Warning', critical: 'Critical' }} />)
    expect(screen.getByText('101%')).toBeVisible()
    expect(screen.getByRole('progressbar').firstElementChild).toHaveClass('bg-destructive')
  })

  it('animates count-up when motion is allowed, reaches the final value and cleans up', () => {
    let callback: FrameRequestCallback | undefined
    const cancel = vi.fn()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => { callback = cb; return 7 }))
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const { unmount } = render(<CountUp value={42} locale="en" />)
    expect(screen.getByText('0')).toBeInTheDocument()
    act(() => callback?.(performance.now() + 500))
    expect(screen.getByText('42')).toBeInTheDocument()
    unmount()
    expect(cancel).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('does not emit invalid SVG geometry for finite extreme values', () => {
    const values = [{ label: 'Low', value: -Number.MAX_VALUE }, { label: 'High', value: Number.MAX_VALUE }]
    const { container, rerender } = render(<Sparkline label="Trend" values={values} emptyLabel="No data" tableLabel="Show data" />)
    expect(container.querySelector('svg')?.outerHTML).not.toMatch(/NaN|Infinity/)
    rerender(<BarChart label="Bars" values={values} emptyLabel="No data" tableLabel="Show data" />)
    expect(container.querySelector('svg')?.outerHTML).not.toMatch(/NaN|Infinity/)
  })

})
