import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getTenantCompany, patchTenantCompany, uploadFile } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { apiBase } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/field'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type CompanyForm = {
  name: string
  legalName: string
  address: string
  city: string
  country: string
  taxId: string
  phone: string
  email: string
}

export function CompanyFields() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const slug = useAuthStore((state) => state.user?.company?.slug ?? '')
  const query = useQuery({
    queryKey: ['company'],
    queryFn: async () => (await getTenantCompany()).data,
  })
  const form = useForm<CompanyForm>({
    defaultValues: {
      name: '',
      legalName: '',
      address: '',
      city: '',
      country: '',
      taxId: '',
      phone: '',
      email: '',
    },
  })
  useEffect(() => {
    if (!query.data) {
      return
    }
    form.reset({
      name: query.data.name,
      legalName: query.data.legalName ?? '',
      address: query.data.address ?? '',
      city: query.data.city ?? '',
      country: query.data.country ?? '',
      taxId: query.data.taxId ?? '',
      phone: query.data.phone ?? '',
      email: query.data.email ?? '',
    })
  }, [query.data, form])
  const save = useMutation({
    mutationFn: (values: CompanyForm) => patchTenantCompany(values),
    onSuccess: async () => {
      toast.success(t('settings.saved'))
      await queryClient.invalidateQueries({ queryKey: ['company'] })
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const onLogo = async (file: File | undefined): Promise<void> => {
    if (!file) {
      return
    }
    try {
      const uploaded = await uploadFile(file)
      await patchTenantCompany({ logoPath: uploaded.data.path })
      toast.success(t('settings.saved'))
      await queryClient.invalidateQueries({ queryKey: ['company'] })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  const logoUrl = query.data?.logoPath
    ? `${apiBase()}/api/files?path=${encodeURIComponent(query.data.logoPath)}`
    : null
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.company')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <Field label={t('settings.name')} htmlFor="name">
            <Input id="name" {...form.register('name')} />
          </Field>
          <Field label={t('settings.slug')} hint={t('settings.slugLocked')}>
            <Input value={query.data?.slug ?? slug} disabled />
          </Field>
          <Field label={t('settings.legalName')} htmlFor="legalName">
            <Input id="legalName" {...form.register('legalName')} />
          </Field>
          <Field label={t('settings.taxId')} htmlFor="taxId" hint={t('settings.taxIdHint')}>
            <Input id="taxId" {...form.register('taxId')} />
          </Field>
          <Field label={t('settings.address')} htmlFor="address">
            <Input id="address" {...form.register('address')} />
          </Field>
          <Field label={t('settings.city')} htmlFor="city">
            <Input id="city" {...form.register('city')} />
          </Field>
          <Field label={t('settings.country')} htmlFor="country">
            <Input id="country" {...form.register('country')} />
          </Field>
          <Field label={t('settings.phone')} htmlFor="phone">
            <Input id="phone" {...form.register('phone')} />
          </Field>
          <Field label={t('settings.email')} htmlFor="email">
            <Input id="email" type="email" {...form.register('email')} />
          </Field>
          <Field label={t('settings.logo')} hint={t('settings.uploadLogo')}>
            <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void onLogo(event.target.files?.[0])} />
            {logoUrl ? <p className="truncate text-xs text-muted-foreground">{query.data?.logoPath}</p> : null}
          </Field>
          <div className="md:col-span-2">
            <Button type="submit" disabled={save.isPending}>{t('settings.save')}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
