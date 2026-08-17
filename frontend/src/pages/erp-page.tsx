import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { listCostEntries, listPartners, listStock, listWarehouses } from '@/lib/api-erp'
import { listMaterials } from '@/lib/api-fleet'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErpPartnersTab } from '@/components/erp/erp-partners-tab'
import { ErpCostsTab } from '@/components/erp/erp-costs-tab'
import { ErpStockTab } from '@/components/erp/erp-stock-tab'

export function ErpPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canWrite = useHasPermission('erp.write')
  const client = useQueryClient()
  const [tab, setTab] = useState('partners')
  const partners = useQuery({
    queryKey: ['erp-partners'],
    queryFn: async () => (await listPartners()).data,
    enabled: tenantReady,
  })
  const costs = useQuery({
    queryKey: ['erp-costs'],
    queryFn: async () => (await listCostEntries()).data,
    enabled: tenantReady,
  })
  const warehouses = useQuery({
    queryKey: ['erp-warehouses'],
    queryFn: async () => (await listWarehouses()).data,
    enabled: tenantReady,
  })
  const stock = useQuery({
    queryKey: ['erp-stock'],
    queryFn: async () => (await listStock()).data,
    enabled: tenantReady,
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
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('erp.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('erp.hint')}</p>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="partners">{t('erp.partners')}</TabsTrigger>
          <TabsTrigger value="costs">{t('erp.costs')}</TabsTrigger>
          <TabsTrigger value="stock">{t('erp.stock')}</TabsTrigger>
        </TabsList>
        <TabsContent value="partners">
          <ErpPartnersTab canWrite={canWrite} rows={partners.data ?? []} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="costs">
          <ErpCostsTab canWrite={canWrite} rows={costs.data ?? []} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="stock">
          <ErpStockTab
            canWrite={canWrite}
            warehouses={warehouses.data ?? []}
            materials={materials.data ?? []}
            stock={stock.data ?? []}
            onChanged={refresh}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
