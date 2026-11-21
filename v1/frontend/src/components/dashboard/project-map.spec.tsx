import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ProjectMap from './project-map'
import type { DashboardProject } from '@/lib/api-dashboard'
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TileLayer: ({ eventHandlers }: { eventHandlers: { tileerror: () => void } }) => <button onClick={eventHandlers.tileerror}>tile failure</button>,
  CircleMarker: () => null,
  useMap: () => ({ fitBounds: vi.fn() }),
}))
describe('project map', () => {
  it('explains unavailable tiles instead of presenting a blank map as success', () => {
    const project = { id: 'p', lat: '43.8563', lng: '18.4131' } as DashboardProject & { lat: string; lng: string }
    render(<ProjectMap projects={[project]} unavailableLabel="Map unavailable" />)
    fireEvent.click(screen.getByText('tile failure'))
    expect(screen.getByRole('status')).toHaveTextContent('Map unavailable')
  })
})
