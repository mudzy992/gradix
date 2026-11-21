import { useLayoutEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createCostEntry, fromPayroll, type CostRow } from '@/lib/api-erp'
import type { MeUser } from '@/lib/api-types'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { getSessionGeneration } from '@/lib/storage'
import { COST_ENTRY_PENDING_QUERY } from '@/lib/constants'
import { errorMessage } from '@/lib/error-message'
import { isValidFixedDecimal } from '@/lib/decimal-input'
import { useCompanySwitchBlock } from '@/hooks/use-company-switch-block'
import { useSensitiveNavigationBlock } from '@/hooks/use-sensitive-navigation'
import { costCategory, costSource, formatAmount } from '@/lib/labels'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/field'


function costScope(): string | null {
  const user = useAuthStore.getState().user
  if (!user) return null
  const platform = user.roles.includes('PLATFORM_ADMIN')
  const company = useCompanyStore.getState()
  const companyId = platform ? company.selectedId : user.companyId
  return companyId ? JSON.stringify([getSessionGeneration(), user.id, companyId, platform ? company.revision : null]) : null
}

// Keep revision out of the cache key so A→B→A can show the retained operation,
// but never permit it to be sent under a changed company selection revision.
function costCacheScope(user: MeUser | null = useAuthStore.getState().user, selectedCompany: string | null = useCompanyStore.getState().selectedId): string | null {
  if (!user) return null
  const companyId = user.roles.includes('PLATFORM_ADMIN') ? selectedCompany : user.companyId
  return companyId ? JSON.stringify([getSessionGeneration(), user.id, companyId]) : null
}

type CostDraft = { amount: string; category: string; date: string }
type PendingCost = CostDraft & { idempotencyKey: string; scope: string }
type CostRecovery = { cacheScope: string; operation: PendingCost; inFlight: boolean; attempt: number }
const emptyCost: CostDraft = { amount: '', category: 'MATERIAL', date: '' }

type Props = {
  canWrite: boolean
  rows: CostRow[]
  isLoading: boolean
  onChanged: () => void
  onProtectedChange: (active: boolean) => void
}

/**
 * FE-12 — troškovi. Nalazi: kategorija je bila sirov `<option>MATERIAL</option>`, izvor je prikazan
 * kao sirov `PAYROLL`/`MANUAL`, iznos je bio `120.000000`, a dva obrasca (ručni trošak i „iz obračuna“)
 * nisu imala ni zaglavlja ni labele, pa se nije znalo koji je koji.
 */
export function ErpCostsTab({ canWrite, rows, isLoading, onChanged, onProtectedChange }: Props) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const selectedCompany = useCompanyStore((state) => state.selectedId)
  const cacheScope = costCacheScope(user, selectedCompany)
  const cacheKey = [COST_ENTRY_PENDING_QUERY, cacheScope] as const
  const recovery = useQuery<CostRecovery | null>({ queryKey: cacheKey, queryFn: async () => null, enabled: false, gcTime: Infinity }).data
  const CATEGORIES = ['FUEL', 'SERVICE', 'MATERIAL', 'LABOR', 'OTHER']
  const [amount, setAmount] = useState('')
  const [amountInvalid, setAmountInvalid] = useState(false)
  const [category, setCategory] = useState('MATERIAL')
  const [date, setDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [retryEnabled, setRetryEnabled] = useState(false)
  const [problem, setProblem] = useState<'key' | 'scope' | null>(null)
  const savingRef = useRef(false)
  const uncertainRef = useRef(false)
  const retryEnabledRef = useRef(false)
  const pendingCost = useRef<PendingCost | null>(null)
  const observedAttempt = useRef(0)
  const boundScope = useRef(cacheScope)
  const scopeWasChanged = useRef(false)
  const parkedDraft = useRef<CostDraft | null>(null)
  const localDraft = useRef<CostDraft>({ amount, category, date })
  useLayoutEffect(() => { localDraft.current = { amount, category, date } }, [amount, category, date])
  useLayoutEffect(() => {
    if (boundScope.current === cacheScope) return
    boundScope.current = cacheScope
    scopeWasChanged.current = true
    pendingCost.current = null
    parkedDraft.current = null
    savingRef.current = false
    uncertainRef.current = false
    retryEnabledRef.current = false
    observedAttempt.current = 0
    setSaving(false)
    setUncertain(false)
    setRetryEnabled(false)
    setProblem(null)
    setAmountInvalid(false)
    setAmount('')
    setCategory('MATERIAL')
    setDate('')
  }, [cacheScope])
  useLayoutEffect(() => {
    if (recovery && recovery.cacheScope === cacheScope) {
      const { operation, inFlight, attempt } = recovery
      const draft = localDraft.current
      if (!scopeWasChanged.current && !pendingCost.current && (draft.amount !== '' || draft.category !== 'MATERIAL' || draft.date !== '')) {
        parkedDraft.current = draft
      }
      pendingCost.current = operation
      savingRef.current = inFlight
      uncertainRef.current = !inFlight || attempt > 1
      if (observedAttempt.current !== attempt) {
        retryEnabledRef.current = false
        setRetryEnabled(false)
        observedAttempt.current = attempt
      }
      setSaving(inFlight)
      setUncertain(!inFlight || attempt > 1)
      setAmountInvalid(false)
      setAmount(operation.amount)
      setCategory(operation.category)
      setDate(operation.date)
    } else if (pendingCost.current) {
      pendingCost.current = null
      savingRef.current = false
      uncertainRef.current = false
      retryEnabledRef.current = false
      observedAttempt.current = 0
      setSaving(false)
      setUncertain(false)
      setRetryEnabled(false)
      setProblem(null)
      const draft = parkedDraft.current ?? emptyCost
      parkedDraft.current = null
      setAmount(draft.amount)
      setCategory(draft.category)
      setDate(draft.date)
    }
    scopeWasChanged.current = false
  }, [recovery, cacheScope])
  // Capture the defaults when this tab mounts, not when the module was loaded.
  const [payrollBaseline, setPayrollBaseline] = useState(() => {
    const now = new Date()
    return { year: String(now.getFullYear()), month: String(now.getMonth() + 1) }
  })
  const [payrollYear, setPayrollYear] = useState(payrollBaseline.year)
  const [payrollMonth, setPayrollMonth] = useState(payrollBaseline.month)
  const [payrollSaving, setPayrollSaving] = useState(false)
  const [payrollUncertain, setPayrollUncertain] = useState(false)
  const payrollSavingRef = useRef(false)
  const payrollUncertainRef = useRef(false)
  const dirty = amount !== '' || category !== 'MATERIAL' || date !== ''
  const payrollDirty = payrollYear !== payrollBaseline.year || payrollMonth !== payrollBaseline.month
  const protectedDraft = (canWrite && (dirty || uncertain || payrollDirty || payrollUncertain)) || saving || payrollSaving
  useCompanySwitchBlock(protectedDraft)
  useSensitiveNavigationBlock(protectedDraft)
  useLayoutEffect(() => {
    onProtectedChange(protectedDraft)
    return () => onProtectedChange(false)
  }, [onProtectedChange, protectedDraft])
  return (
    <div className="grid gap-3" aria-busy={isLoading}>
      {canWrite ? (
        <form
          className="grid gap-2 rounded-md border p-3"
          aria-busy={saving}
          onSubmit={async (event) => {
            event.preventDefault()
            if (savingRef.current || (uncertainRef.current && !retryEnabledRef.current)) return
            const scope = costScope()
            if (!scope || !cacheScope || costCacheScope() !== cacheScope || (pendingCost.current && pendingCost.current.scope !== scope)) {
              setProblem('scope')
              return
            }
            const shared = client.getQueryData<CostRecovery | null>(cacheKey)
            if (shared?.inFlight || (shared && shared.operation.idempotencyKey !== pendingCost.current?.idempotencyKey) || (!shared && pendingCost.current)) return
            if (!pendingCost.current) {
              if (!isValidFixedDecimal(amount, 10, 2, true, false)) {
                setAmountInvalid(true)
                return
              }
              try {
                pendingCost.current = { amount, category, date, idempotencyKey: crypto.randomUUID(), scope }
              } catch {
                setProblem('key')
                return
              }
            }
            const operation = pendingCost.current
            const attempt = (shared?.attempt ?? 0) + 1
            client.setQueryData(cacheKey, { cacheScope, operation, inFlight: true, attempt } satisfies CostRecovery)
            savingRef.current = true
            retryEnabledRef.current = false
            setRetryEnabled(false)
            setProblem(null)
            setAmountInvalid(false)
            setSaving(true)
            const stillOurs = () => {
              const current = client.getQueryData<CostRecovery | null>(cacheKey)
              return current?.operation.idempotencyKey === operation.idempotencyKey && current.attempt === attempt
            }
            try {
              await createCostEntry({ amount: operation.amount, category: operation.category, date: operation.date, idempotencyKey: operation.idempotencyKey })
              if (!stillOurs()) return
              if (costScope() !== operation.scope) {
                client.setQueryData(cacheKey, { cacheScope, operation, inFlight: false, attempt } satisfies CostRecovery)
                if (boundScope.current === cacheScope && costCacheScope() === cacheScope) {
                  setProblem('scope')
                  uncertainRef.current = true
                  setUncertain(true)
                }
                return
              }
            } catch (error) {
              if (!stillOurs()) return
              client.setQueryData(cacheKey, { cacheScope, operation, inFlight: false, attempt } satisfies CostRecovery)
              if (boundScope.current === cacheScope && costCacheScope() === cacheScope) {
                uncertainRef.current = true
                setUncertain(true)
                toast.error(errorMessage(error))
              }
              return
            } finally {
              if (stillOurs() && boundScope.current === cacheScope && costCacheScope() === cacheScope) {
                savingRef.current = false
                setSaving(false)
              }
            }
            client.setQueryData(cacheKey, null)
            pendingCost.current = null
            uncertainRef.current = false
            setUncertain(false)
            const draft = parkedDraft.current ?? emptyCost
            parkedDraft.current = null
            setAmount(draft.amount)
            setCategory(draft.category)
            setDate(draft.date)
            onChanged()
          }}
        >
          <h2 className="text-sm font-medium">{t('erp.createCost')}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('erp.costAmount')} htmlFor="cost-amount" error={amountInvalid ? t('erp.costAmountInvalid') : undefined}>
              <Input
                id="cost-amount"
                name="amount"
                required
                inputMode="decimal"
                className="w-32"
                disabled={saving || uncertain}
                value={amount}
                onChange={(event) => { setAmount(event.target.value); setAmountInvalid(false) }}
              />
            </Field>
            <Field label={t('erp.categoryLabel')} htmlFor="cost-category">
              <select
                id="cost-category"
                name="category"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                disabled={saving || uncertain}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {CATEGORIES.map((category) => {
                  const meta = costCategory(category)
                  return (
                    <option key={category} value={category}>
                      {t(meta.labelKey, { defaultValue: category })}
                    </option>
                  )
                })}
              </select>
            </Field>
            <Field label={t('erp.costDate')} htmlFor="cost-date">
              <Input
                id="cost-date"
                name="date"
                type="date"
                required
                className="w-40"
                disabled={saving || uncertain}
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={saving || (uncertain && !retryEnabled)}>{t('erp.createCost')}</Button>
            {dirty || uncertain ? (
              <Button type="button" variant="outline" disabled={saving} onClick={() => {
                const current = client.getQueryData<CostRecovery | null>(cacheKey)
                if (current?.inFlight || (current && current.operation.idempotencyKey !== pendingCost.current?.idempotencyKey)) return
                if (current) client.setQueryData(cacheKey, null)
                const draft = parkedDraft.current ?? emptyCost
                parkedDraft.current = null
                setAmount(draft.amount)
                setAmountInvalid(false)
                setCategory(draft.category)
                setDate(draft.date)
                pendingCost.current = null
                uncertainRef.current = false
                retryEnabledRef.current = false
                setRetryEnabled(false)
                setProblem(null)
                setUncertain(false)
              }}>{t('common.discardDraft')}</Button>
            ) : null}
          </div>
          {saving ? <p role="status" className="text-sm">{t('common.savingWait')}</p> : null}
          {problem ? <p role="alert" className="text-sm text-destructive">{t(problem === 'key' ? 'erp.costKeyUnavailable' : 'erp.costScopeChanged')}</p> : null}
          {uncertain ? (
            <div className="grid gap-2">
              <p role="alert" className="text-sm text-destructive">{t('erp.costUnknown')}</p>
              {!retryEnabled && !saving ? <Button type="button" variant="outline" onClick={() => {
                retryEnabledRef.current = true
                setRetryEnabled(true)
              }}>{t('common.enableRetry')}</Button> : null}
            </div>
          ) : null}
        </form>
      ) : null}

      {canWrite ? (
        <form
          className="grid gap-2 rounded-md border p-3"
          aria-busy={payrollSaving}
          onSubmit={async (event) => {
            event.preventDefault()
            if (payrollSavingRef.current || payrollUncertainRef.current) return
            payrollSavingRef.current = true
            setPayrollSaving(true)
            try {
              await fromPayroll({ year: Number(payrollYear), month: Number(payrollMonth) })
              setPayrollBaseline({ year: payrollYear, month: payrollMonth })
              onChanged()
            } catch (error) {
              payrollUncertainRef.current = true
              setPayrollUncertain(true)
              toast.error(errorMessage(error))
            } finally {
              payrollSavingRef.current = false
              setPayrollSaving(false)
            }
          }}
        >
          <h2 className="text-sm font-medium">{t('erp.fromPayroll')}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('erp.year')} htmlFor="cost-year">
              <Input
                id="cost-year"
                name="year"
                type="number"
                min={2000}
                max={2100}
                required
                disabled={payrollSaving}
                value={payrollYear}
                onChange={(event) => setPayrollYear(event.target.value)}
                className="w-24"
              />
            </Field>
            <Field label={t('erp.month')} htmlFor="cost-month">
              <Input
                id="cost-month"
                name="month"
                type="number"
                min={1}
                max={12}
                required
                disabled={payrollSaving}
                value={payrollMonth}
                onChange={(event) => setPayrollMonth(event.target.value)}
                className="w-20"
              />
            </Field>
            <Button type="submit" variant="outline" disabled={payrollSaving || payrollUncertain}>
              {t('erp.fromPayroll')}
            </Button>
            {payrollDirty || payrollUncertain ? (
              <Button type="button" variant="outline" disabled={payrollSaving} onClick={() => {
                setPayrollYear(payrollBaseline.year)
                setPayrollMonth(payrollBaseline.month)
                payrollUncertainRef.current = false
                setPayrollUncertain(false)
              }}>{t('common.discardDraft')}</Button>
            ) : null}
          </div>
          {payrollSaving ? <p role="status" className="text-sm">{t('common.savingWait')}</p> : null}
          {payrollUncertain ? (
            <div className="grid gap-2">
              <p role="alert" className="text-sm text-destructive">{t('erp.payrollUnknown')}</p>
              <Button type="button" variant="outline" onClick={() => {
                payrollUncertainRef.current = false
                setPayrollUncertain(false)
              }}>{t('common.enableRetry')}</Button>
            </div>
          ) : null}
        </form>
      ) : null}

      {!isLoading && rows.length > 0 ? (
        <p className="text-sm text-muted-foreground">{t('erp.costsCount', { count: rows.length })}</p>
      ) : null}

      <ul className="grid gap-2">
        {isLoading
          ? [0, 1, 2].map((index) => (
              <li key={`skeleton-${index}`}>
                <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
              </li>
            ))
          : rows.map((row) => {
              const category = costCategory(row.category)
              const source = costSource(row.source)
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={category.tone}>{t(category.labelKey, { defaultValue: row.category })}</Badge>
                    <span className="font-medium">{formatAmount(row.amount)}</span>
                    <span className="text-muted-foreground">{row.date.slice(0, 10)}</span>
                  </span>
                  <Badge variant={source.tone}>{t(source.labelKey, { defaultValue: row.source })}</Badge>
                </li>
              )
            })}
        {!isLoading && rows.length === 0 ? (
          <li className="text-sm text-muted-foreground">{t('erp.costsEmpty')}</li>
        ) : null}
      </ul>
    </div>
  )
}
