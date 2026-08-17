import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { i18n } from '@/i18n'
import { ApiError } from '@/lib/api-types'
import {
  getPublicCompany,
  listPublicProjects,
  publicAssetUrl,
  type PublicCompany,
  type PublicProject,
} from '@/lib/api-public'

function detectLang(): 'bs' | 'en' {
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'bs'
}

export function PublicSitePage() {
  const { slug = '' } = useParams()
  const [lang, setLang] = useState<'bs' | 'en'>(detectLang)
  const t = useMemo(() => i18n.getFixedT(lang), [lang])
  const [company, setCompany] = useState<PublicCompany | null>(null)
  const [projects, setProjects] = useState<PublicProject[]>([])
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let cancelled = false
    void Promise.all([getPublicCompany(slug), listPublicProjects(slug)])
      .then(([firm, list]) => {
        if (cancelled) {
          return
        }
        setCompany(firm.data)
        setProjects(list.data)
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        if (error instanceof ApiError && error.status === 404) {
          setMissing(true)
          return
        }
        setMissing(true)
      })
    return () => {
      cancelled = true
    }
  }, [slug])
  if (missing) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-6 text-foreground">
        <p>{t('public.notFound')}</p>
      </main>
    )
  }
  if (!company) {
    return <main className="min-h-svh bg-background" />
  }
  const logoSrc = company.logoAssetId ? publicAssetUrl(company.logoAssetId) : null
  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-6">
        <div className="flex items-center gap-3">
          {logoSrc ? (
            <img src={logoSrc} alt="" className="h-10 w-10 rounded object-cover" />
          ) : null}
          <span className="text-sm font-medium tracking-wide">{company.name}</span>
        </div>
        <div className="flex gap-1" role="group" aria-label={t('public.langLabel')}>
          <button
            type="button"
            className={`px-2 py-1 text-xs ${lang === 'bs' ? 'text-accent' : 'text-muted-foreground'}`}
            aria-pressed={lang === 'bs'}
            onClick={() => setLang('bs')}
          >
            {t('public.langBs')}
          </button>
          <button
            type="button"
            className={`px-2 py-1 text-xs ${lang === 'en' ? 'text-accent' : 'text-muted-foreground'}`}
            aria-pressed={lang === 'en'}
            onClick={() => setLang('en')}
          >
            {t('public.langEn')}
          </button>
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-8">
        <h1 className="text-4xl font-semibold tracking-tight">{company.name}</h1>
        {company.tagline ? (
          <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{company.tagline}</p>
        ) : null}
      </section>
      <section className="mx-auto max-w-5xl px-6 pb-16" aria-labelledby="about">
        <h2 id="about" className="text-xl font-medium">{t('public.about')}</h2>
        <dl className="mt-4 grid gap-2 text-sm text-muted-foreground">
          {company.address ? <div>{t('public.address')}: {company.address}</div> : null}
          {company.city ? <div>{company.city}</div> : null}
        </dl>
      </section>
      <section className="mx-auto max-w-5xl px-6 pb-16" aria-labelledby="projects">
        <h2 id="projects" className="text-xl font-medium">{t('public.projects')}</h2>
        {projects.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{t('public.emptyProjects')}</p>
        ) : (
          <ul className="mt-6 grid gap-6 sm:grid-cols-2">
            {projects.map((project) => (
              <li key={project.id} className="overflow-hidden rounded-lg bg-card">
                {project.coverAssetId ? (
                  <img
                    src={publicAssetUrl(project.coverAssetId)}
                    alt=""
                    className="h-40 w-full object-cover"
                  />
                ) : (
                  <div className="h-40 bg-secondary" />
                )}
                <div className="p-4">
                  <p className="font-medium">{project.name}</p>
                  <p className="text-sm text-muted-foreground">{project.locality ?? project.status}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mx-auto max-w-5xl px-6 pb-20" aria-labelledby="contact">
        <h2 id="contact" className="text-xl font-medium">{t('public.contact')}</h2>
        <div className="mt-4 grid gap-1 text-sm text-muted-foreground">
          {company.phone ? <p>{t('public.phone')}: {company.phone}</p> : null}
          {company.contact ? <p>{company.contact}</p> : null}
        </div>
      </section>
    </main>
  )
}
