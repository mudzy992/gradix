import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { listMachines } from '@/lib/api-fleet'
import { gpsSource, machineStatus } from '@/lib/labels'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { Button } from '@/components/ui/button'
import 'leaflet/dist/leaflet.css'

const SARAJEVO: [number, number] = [43.8563, 18.4131]
/** Boje iz palete C (D-040) — ranije su ovdje stajale boje odbačene palate. */
const PIN_COLOR = '#0F5132'
const PIN_FILL = '#0F766E'

/**
 * FE-09 — mapa flote. Nalazi: sirov `status` i sirov `PHONE`/`IOT` u balončiću, nema stanja
 * učitavanja/greške, a mapa (SVG platno) nije bila čitljiva čitaču ekrana. Sada: prevedeni status
 * i izvor GPS-a, greška sa ponovnim pokušajem, prazno stanje i **tekstualna lista** istih mašina.
 */
export function FleetMapPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const query = useQuery({
    queryKey: ['machines', { limit: 100 }],
    queryFn: async () => (await listMachines({ limit: 100 })).data,
    enabled: tenantReady,
  })
  const machines = query.data ?? []
  const pins = machines.filter((row) => row.lastLat && row.lastLng)
  const center: [number, number] = pins[0]
    ? [Number(pins[0].lastLat), Number(pins[0].lastLng)]
    : SARAJEVO
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('fleet.map')}</h1>
        <p className="text-sm text-muted-foreground">{t('fleet.mapAlt', { count: pins.length })}</p>
      </div>

      {query.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{t('fleet.loadError')}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {t('dashboard.retry')}
          </Button>
        </div>
      ) : null}

      <div
        aria-busy={query.isLoading}
        className="h-[70vh] overflow-hidden rounded-lg border"
        // Mapa je dekoracija za asistivne tehnologije — sadržaj je u listi ispod (WCAG 1.1.1).
        aria-hidden={pins.length === 0 ? true : undefined}
      >
        {query.isLoading ? (
          <div className="h-full w-full animate-pulse bg-muted" />
        ) : (
          <MapContainer center={center} zoom={12} className="h-full w-full" scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {pins.map((row) => {
              const status = machineStatus(row.status)
              const source = row.lastGpsSource ? gpsSource(row.lastGpsSource) : null
              return (
                <CircleMarker
                  key={row.id}
                  center={[Number(row.lastLat), Number(row.lastLng)]}
                  radius={8}
                  pathOptions={{ color: PIN_COLOR, fillColor: PIN_FILL, fillOpacity: 0.9 }}
                >
                  <Popup>
                    <span className="font-medium">{row.name}</span>
                    {' · '}
                    {t(status.labelKey, { defaultValue: row.status })}
                    {source ? ` · ${t(source.labelKey, { defaultValue: row.lastGpsSource })}` : ''}
                  </Popup>
                </CircleMarker>
              )
            })}
          </MapContainer>
        )}
      </div>

      <section aria-labelledby="fleet-map-list" className="grid gap-1">
        <h2 id="fleet-map-list" className="text-lg font-medium">
          {t('fleet.mapList')}
        </h2>
        {query.isSuccess && pins.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('fleet.mapEmpty')}</p>
        ) : (
          <ul className="text-sm">
            {pins.map((row) => {
              const status = machineStatus(row.status)
              return (
                <li key={row.id}>
                  {row.name} · {t(status.labelKey, { defaultValue: row.status })}
                  {row.lastGpsAt ? ` · ${new Date(row.lastGpsAt).toLocaleString()}` : ''}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
