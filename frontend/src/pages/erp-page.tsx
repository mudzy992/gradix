import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { listCostEntries, listPartners, listStock, listWarehouses } from '@/lib/api-erp'
import { listMaterials } from '@/lib/api-fleet'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErpPartnersTab } from '@/components/erp/erp-partners-tab'
import { ErpCostsTab } from '@/components/erp/erp-costs-tab'
import { ErpStockTab } from '@/components/erp/erp-stock-tab'

/**
 * FE-12 — ERP-lite. Nalazi: sva četiri upita su se izvršavala odmah (i „lager“ i „materijali“ čak i
 * kad korisnik nikad ne otvori taj tab), a **nijedno stanje nije bilo vidljivo** — pad API-ja je
 * izgledao kao prazna lista. Sada: upit se učitava po tabu, greška ima trajni `role="alert"` sa
 * ponovnim pokušajem, a svaki tab dobija `isLoading`/`isError` da pokaže skeleton i prazno stanje.
 */
export function ErpPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canWrite = useHasPermission('erp.write')
  const client = useQueryClient()
  const [tab, setTab] = useState('partners')
  const [partnerProtected, setPartnerProtected] = useState(false)
  const partners = useQuery({
    queryKey: ['erp-partners'],
    queryFn: async () => (await listPartners()).data,
    enabled: tenantReady && tab === 'partners',
  })
  const costs = useQuery({
    queryKey: ['erp-costs'],
    queryFn: async () => (await listCostEntries()).data,
    enabled: tenantReady && tab === 'costs',
  })
  const warehouses = useQuery({
    queryKey: ['erp-warehouses'],
    queryFn: async () => (await listWarehouses()).data,
    enabled: tenantReady && tab === 'stock',
  })
  const stock = useQuery({
    queryKey: ['erp-stock'],
    queryFn: async () => (await listStock()).data,
    enabled: tenantReady && tab === 'stock',
  })
  const materials = useQuery({
    queryKey: ['materials'],
    queryFn: async () => (await listMaterials()).data,
    enabled: tenantReady && tab === 'stock',
  })
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['erp-partners'] })
    void client.invalidateQueries({ queryKey: ['erp-costs'] })
    void client.invalidateQueries({ queryKey: ['erp-warehouses'] })
    void client.invalidateQueries({ queryKey: ['erp-stock'] })
  }
  const failed = partners.isError || costs.isError || warehouses.isError || stock.isError
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('erp.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('erp.hint')}</p>
      <Tabs value={tab} onValueChange={(next) => {
        if (next !== tab && partnerProtected) {
          toast.error(t('erp.partnerTabBlocked'))
          return
        }
        setTab(next)
      }}>
        <TabsList>
          <TabsTrigger value="partners">{t('erp.partners')}</TabsTrigger>
          <TabsTrigger value="costs">{t('erp.costs')}</TabsTrigger>
          <TabsTrigger value="stock">{t('erp.stock')}</TabsTrigger>
        </TabsList>
        <TabsContent value="partners">
          <ErpPartnersTab
            canWrite={canWrite}
            rows={partners.data ?? []}
            isLoading={partners.isLoading}
            onChanged={refresh}
            onProtectedChange={setPartnerProtected}
          />
        </TabsContent>
        <TabsContent value="costs">
          <ErpCostsTab canWrite={canWrite} rows={costs.data ?? []} isLoading={costs.isLoading} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="stock">
          <ErpStockTab
            canWrite={canWrite}
            warehouses={warehouses.data ?? []}
            materials={materials.data ?? []}
            stock={stock.data ?? []}
            isLoading={warehouses.isLoading || stock.isLoading || materials.isLoading}
            onChanged={refresh}
          />
        </TabsContent>
      </Tabs>

      {failed ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{t('erp.loadError')}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void partners.refetch()
              void costs.refetch()
              void warehouses.refetch()
              void stock.refetch()
            }}
          >
            {t('dashboard.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
