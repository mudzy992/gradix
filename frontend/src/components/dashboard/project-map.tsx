import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, useMap } from 'react-leaflet'
import type { DashboardProject } from '@/lib/api-dashboard'
import 'leaflet/dist/leaflet.css'

type LocatedProject = DashboardProject & { lat: string; lng: string }
function FitProjects({ projects }: { projects: LocatedProject[] }) {
  const map = useMap()
  useEffect(() => {
    if (projects.length > 1) map.fitBounds(projects.map((project) => [Number(project.lat), Number(project.lng)]), { padding: [24, 24], maxZoom: 12 })
  }, [map, projects])
  return null
}
/** Decorative, noninteractive map; the surrounding list is the accessible alternative. */
export default function ProjectMap({ projects, unavailableLabel }: { projects: LocatedProject[]; unavailableLabel: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="relative">
    <div aria-hidden="true" className="h-56 overflow-hidden rounded-lg border">
      <MapContainer center={[Number(projects[0].lat), Number(projects[0].lng)]} zoom={10} zoomControl={false} attributionControl={false} keyboard={false} dragging={false} scrollWheelZoom={false} className="h-full w-full">
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" eventHandlers={{ tileerror: () => setFailed(true) }} />
        <FitProjects projects={projects} />
        {projects.map((project) => <CircleMarker key={project.id} center={[Number(project.lat), Number(project.lng)]} radius={7} interactive={false} pathOptions={{ color: '#0F5132', fillColor: '#0F766E', fillOpacity: 0.9 }} />)}
      </MapContainer>
    </div>
    {failed && <div role="status" className="absolute inset-0 z-[500] flex items-center justify-center rounded-lg bg-muted p-5 text-center text-sm text-muted-foreground">{unavailableLabel}</div>}
    </div>
  )
}
