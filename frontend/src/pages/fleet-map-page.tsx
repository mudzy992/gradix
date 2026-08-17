import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { listMachines } from '@/lib/api-fleet'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import 'leaflet/dist/leaflet.css'

const SARAJEVO: [number, number] = [43.8563, 18.4131]

export function FleetMapPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const query = useQuery({
    queryKey: ['machines', { limit: 100 }],
    queryFn: async () => (await listMachines({ limit: 100 })).data,
    enabled: tenantReady,
  })
  const pins = (query.data ?? []).filter((row) => row.lastLat && row.lastLng)
  const center: [number, number] = pins[0]
    ? [Number(pins[0].lastLat), Number(pins[0].lastLng)]
    : SARAJEVO
  return (
    <div className="grid gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{t('fleet.map')}</h1>
      <div className="h-[70vh] overflow-hidden rounded-lg border">
        <MapContainer center={center} zoom={12} className="h-full w-full" scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {pins.map((row) => (
            <CircleMarker
              key={row.id}
              center={[Number(row.lastLat), Number(row.lastLng)]}
              radius={8}
              pathOptions={{ color: '#1B365D', fillColor: '#C45C26', fillOpacity: 0.9 }}
            >
              <Popup>
                {row.name} · {row.status}
                {row.lastGpsAt ? ` · ${row.lastGpsSource === 'IOT' ? 'IOT' : 'PHONE'}` : ''}
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  )
}
