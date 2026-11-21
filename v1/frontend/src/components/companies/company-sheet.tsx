import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useSensitiveNavigationBlock } from '@/hooks/use-sensitive-navigation'
import { toast } from 'sonner'
import { createCompany, patchCompanyPlatform } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import type { CompanyRow } from '@/lib/api-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/field'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

type Values = {
  name: string
  slug: string
  firstName: string
  lastName: string
  email: string
}

type Props = {
  company: CompanyRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (temporaryPassword: string) => void
  onSaved: () => void
}

const SLUG = /^[a-z0-9-]{3,40}$/

/**
 * FE-13 — obrazac firme. Nalazi: izmjena je slala i `legalName` koji korisnik **ne vidi** u obrascu
 * (vrijednost sa backenda, pa se tiho prepisivala), slug nije imao nikakvu provjeru formata (greška je
 * dolazila sa API-ja kao toast), a polja nisu imala poruke uz sebe.
 */
export function CompanySheet({ company, open, onOpenChange, onCreated, onSaved }: Props) {
  const { t } = useTranslation()
  useSensitiveNavigationBlock(open)
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const savingRef = useRef(false)
  const uncertainRef = useRef(false)
  useEffect(() => { if (!open) { uncertainRef.current = false; setUncertain(false) } }, [open])
  const form = useForm<Values>({
    // FE-13: polja prvog admina postoje samo pri kreiranju — `shouldUnregister` sklanja njihova
    // pravila kad se odmontiraju (inače `required` pada u uređivanju, gdje polja nema u DOM-u).
    shouldUnregister: true,
    values: {
      name: company?.name ?? '',
      slug: company?.slug ?? '',
      firstName: '',
      lastName: '',
      email: '',
    },
  })
  const errors = form.formState.errors
  /**
   * FE-13 — validacija je u `handleSubmit`-u, ne u `register` pravilima. Razlog je stvarni bug:
   * polja prvog admina postoje samo pri kreiranju, a RHF pravila registrovanih (pa odmontiranih)
   * polja ume da zadrži — u uređivanju je `required` padao na poljima kojih nema u DOM-u i forma se
   * nije mogla sačuvati. Ovako se provjerava tačno ono što je na ekranu.
   */
  const validate = (values: Values): boolean => {
    let valid = true
    const fail = (field: keyof Values, message: string): void => {
      form.setError(field, { message })
      valid = false
    }
    if (!values.name.trim()) {
      fail('name', t('common.required'))
    }
    if (!company) {
      if (!values.slug.trim()) {
        fail('slug', t('common.required'))
      } else if (!SLUG.test(values.slug)) {
        fail('slug', t('companies.slugInvalid'))
      }
      if (!values.firstName.trim()) {
        fail('firstName', t('common.required'))
      }
      if (!values.lastName.trim()) {
        fail('lastName', t('common.required'))
      }
      if (!values.email.trim()) {
        fail('email', t('common.required'))
      }
    }
    return valid
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (savingRef.current || (!company && uncertainRef.current)) return
    if (!validate(values)) {
      return
    }
    savingRef.current = true
    setSaving(true)
    try {
      if (company) {
        // Samo ono što je u obrascu; prije se slao i `legalName` sa backenda.
        await patchCompanyPlatform(company.id, { name: values.name })
        onSaved()
      } else {
        const created = await createCompany({
          name: values.name,
          slug: values.slug,
          admin: {
            firstName: values.firstName,
            lastName: values.lastName,
            email: values.email,
          },
        })
        onCreated(created.data.temporaryPassword)
      }
      onOpenChange(false)
    } catch (error) {
      if (!company) { uncertainRef.current = true; setUncertain(true) }
      toast.error(errorMessage(error))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  })
  return (
    <Sheet open={open} onOpenChange={(next) => { if (next || !savingRef.current) onOpenChange(next) }}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{company ? t('companies.edit') : t('companies.create')}</SheetTitle>
        </SheetHeader>
        <form className="grid gap-4 px-4" onSubmit={onSubmit} aria-busy={saving}>
          {saving ? <p role="status" className="text-sm">{t('common.savingWait')}</p> : null}
          <fieldset disabled={saving} className="grid gap-4">
            <Field label={t('settings.name')} htmlFor="name" error={errors.name?.message}>
              <Input id="name" {...form.register('name')} />
            </Field>
            <Field
              label={t('settings.slug')}
              htmlFor="slug"
              hint={company ? t('settings.slugLocked') : t('companies.slugHint')}
              error={errors.slug?.message}
            >
              <Input id="slug" disabled={Boolean(company)} {...form.register('slug')} />
            </Field>
            {!company ? (
              <>
                <p className="text-sm font-medium">{t('companies.admin')}</p>
                <Field label={t('users.firstName')} htmlFor="adminFirst" error={errors.firstName?.message}>
                  <Input
                    id="adminFirst"
                    {...form.register('firstName')}
                  />
                </Field>
                <Field label={t('users.lastName')} htmlFor="adminLast" error={errors.lastName?.message}>
                  <Input
                    id="adminLast"
                    {...form.register('lastName')}
                  />
                </Field>
                <Field label={t('auth.email')} htmlFor="adminEmail" error={errors.email?.message}>
                  <Input
                    id="adminEmail"
                    type="email"
                    {...form.register('email')}
                  />
                </Field>
              </>
            ) : null}
            {uncertain ? (
              <div className="grid gap-2">
                <p role="alert" className="text-sm text-destructive">{t('common.createUnknown')}</p>
                <Button type="button" variant="outline" onClick={() => { uncertainRef.current = false; setUncertain(false) }}>{t('common.enableRetry')}</Button>
              </div>
            ) : null}
            <SheetFooter>
              <Button type="submit" disabled={uncertain}>{t('common.save')}</Button>
            </SheetFooter>
          </fieldset>
        </form>
      </SheetContent>
    </Sheet>
  )
}
