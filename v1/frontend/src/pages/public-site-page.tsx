import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { i18n } from '@/i18n'
import { ApiError } from '@/lib/api-types'
import { projectStatus } from '@/lib/labels'
import {
  getPublicCompany,
  listPublicProjects,
  publicAssetUrl,
  type PublicCompany,
  type PublicProject,
} from '@/lib/api-public'

type Phase = 'loading' | 'ready' | 'missing' | 'error'

/** `public.contact` je slobodan tekst; link pravimo samo kad stvarno liči na e-mail. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Jezik javnog sajta. Redoslijed: **jezik aplikacije** (korisnikov izbor se pamti) → jezik browsera.
 * Prije se gledao samo `navigator.language`, pa je posjetilac koji je u aplikaciji izabrao bosanski
 * dobijao engleski javni sajt (i obrnuto) — a `i18n.language` je već inicijalizovan u `index.ts`.
 */
function detectLang(): 'bs' | 'en' {
  const appLanguage = i18n.resolvedLanguage ?? i18n.language
  if (appLanguage?.startsWith('en')) {
    return 'en'
  }
  if (appLanguage?.startsWith('bs')) {
    return 'bs'
  }
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'bs'
}

/**
 * FE-14 — SEO/meta na javnom sajtu. Prije: `<title>` je uvijek bio „Gradix“, nije bilo opisa za
 * pretrage ni za dijeljenje (`og:`), a `<html lang>` je ostajao `bs` i kad korisnik prebaci na
 * engleski. Svaki upis pamti prethodnu vrijednost i vraća je pri odlasku sa stranice (SPA navigacija
 * ne smije ostaviti meta podatke javnog sajta na aplikaciji).
 */
function upsertMeta(attribute: 'name' | 'property', key: string, content: string): () => void {
  const selector = `meta[${attribute}="${key}"]`
  const existing = document.head.querySelector<HTMLMetaElement>(selector)
  if (existing) {
    const before = existing.getAttribute('content') ?? ''
    existing.setAttribute('content', content)
    return () => existing.setAttribute('content', before)
  }
  const element = document.createElement('meta')
  element.setAttribute(attribute, key)
  element.setAttribute('content', content)
  document.head.appendChild(element)
  return () => element.remove()
}

function upsertCanonical(href: string): () => void {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (existing) {
    const before = existing.getAttribute('href') ?? ''
    existing.setAttribute('href', href)
    return () => existing.setAttribute('href', before)
  }
  const link = document.createElement('link')
  link.rel = 'canonical'
  link.href = href
  document.head.appendChild(link)
  return () => link.remove()
}

/**
 * FE-14 — javni sajt firme (`/p/:slug`, bez prijave). Nalazi: dok su podaci stizali, stranica je bila
 * **prazan bijeli ekran** (nema skeletona ni `aria-busy`); svaka greška (500, mreža, 429) izgledala je
 * kao „stranica nije pronađena“ i nije bilo ponovnog pokušaja; `<title>`/meta opis su bili aplikacijski,
 * a `<html lang>` se nije mijenjao sa izborom jezika; status projekta se prikazivao **sirov**
 * (`PLANNING`, `IN_PROGRESS`) kad projekat nema lokaciju; `<dl>` nije imao `dt`/`dd`; slike nisu bile
 * `lazy`; pad liste projekata je rušio **cijelu** stranicu (firma se ne bi prikazala).
 */
export function PublicSitePage() {
  const { slug = '' } = useParams()
  const [lang, setLang] = useState<'bs' | 'en'>(detectLang)
  const t = useMemo(() => i18n.getFixedT(lang), [lang])
  const [company, setCompany] = useState<PublicCompany | null>(null)
  // `null` = lista još nije odgovorila; prazan niz = stvarno nema projekata.
  const [projects, setProjects] = useState<PublicProject[] | null>(null)
  const [projectsFailed, setProjectsFailed] = useState(false)
  const [phase, setPhase] = useState<Phase>('loading')
  const [attempt, setAttempt] = useState(0)
  // 429 (PUBLIC_GET throttle) nije kvar servera — poruka mora reći „sačekajte“, ne „pokušajte odmah“.
  const [throttled, setThrottled] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    setCompany(null)
    setProjects(null)
    setProjectsFailed(false)
    setThrottled(false)
    getPublicCompany(slug)
      .then((result) => {
        if (cancelled) {
          return
        }
        setCompany(result.data)
        setPhase('ready')
        // Lista projekata se učitava odvojeno: njen pad ne smije sakriti firmu i kontakt.
        return listPublicProjects(slug)
          .then((list) => {
            if (!cancelled) {
              setProjects(list.data)
            }
          })
          .catch(() => {
            if (!cancelled) {
              setProjects([])
              setProjectsFailed(true)
            }
          })
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        // 404 = firma stvarno ne postoji; sve ostalo je privremeni problem (500, mreža, 429).
        setThrottled(error instanceof ApiError && error.status === 429)
        setPhase(error instanceof ApiError && error.status === 404 ? 'missing' : 'error')
      })
    return () => {
      cancelled = true
    }
  }, [slug, attempt])

  useEffect(() => {
    const previousLang = document.documentElement.lang
    document.documentElement.lang = lang
    return () => {
      document.documentElement.lang = previousLang
    }
  }, [lang])

  useEffect(() => {
    if (!company) {
      return
    }
    const previousTitle = document.title
    const description = company.tagline || company.contact || company.name
    const title = company.tagline ? `${company.name} — ${company.tagline}` : company.name
    document.title = title
    const restores = [
      upsertMeta('name', 'description', description),
      upsertMeta('property', 'og:title', title),
      upsertMeta('property', 'og:description', description),
      upsertMeta('property', 'og:type', 'website'),
      upsertCanonical(`${window.location.origin}/p/${company.slug}`),
    ]
    if (company.logoAssetId) {
      restores.push(upsertMeta('property', 'og:image', publicAssetUrl(company.logoAssetId)))
    }
    return () => {
      document.title = previousTitle
      for (const restore of restores) {
        restore()
      }
    }
  }, [company])

  if (phase === 'missing') {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-6 text-foreground">
        <p>{t('public.notFound')}</p>
      </main>
    )
  }

  if (phase === 'error') {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-6 text-foreground">
        <div role="alert" className="grid max-w-md gap-3 text-center">
          <p className="font-medium">{t(throttled ? 'public.loadErrorBusy' : 'public.loadError')}</p>
          <p className="text-sm text-muted-foreground">
            {t(throttled ? 'public.loadErrorBusyHint' : 'public.loadErrorHint')}
          </p>
          <button
            type="button"
            className="mx-auto rounded-md border px-3 py-1.5 text-sm"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t('dashboard.retry')}
          </button>
        </div>
      </main>
    )
  }

  if (phase === 'loading' || !company) {
    return (
      <main className="mx-auto grid min-h-svh max-w-5xl gap-4 px-6 py-10" aria-busy="true">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded bg-muted" />
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        </div>
        <div className="mt-4 h-10 w-64 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-muted" />
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {[0, 1].map((index) => (
            <div key={`public-skeleton-${index}`} className="h-48 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
        <span className="sr-only">{t('common.loading')}</span>
      </main>
    )
  }

  const logoSrc = company.logoAssetId ? publicAssetUrl(company.logoAssetId) : null
  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-6">
        <div className="flex items-center gap-3">
          {logoSrc ? (
            <img src={logoSrc} alt="" width={40} height={40} className="h-10 w-10 rounded object-cover" />
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
        {company.tagline ? <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{company.tagline}</p> : null}
      </section>
      {company.address || company.city ? (
        <section className="mx-auto max-w-5xl px-6 pb-16" aria-labelledby="about">
          <h2 id="about" className="text-xl font-medium">
            {t('public.about')}
          </h2>
          <dl className="mt-4 grid gap-1 text-sm text-muted-foreground">
            <div>
              <dt className="sr-only">{t('public.address')}</dt>
              <dd>{[company.address, company.city].filter(Boolean).join(', ')}</dd>
            </div>
          </dl>
        </section>
      ) : null}
      <section className="mx-auto max-w-5xl px-6 pb-16" aria-labelledby="projects">
        <h2 id="projects" className="text-xl font-medium">
          {t('public.projects')}
        </h2>
        {projects === null ? (
          <div className="mt-6 grid gap-6 sm:grid-cols-2" aria-busy="true">
            {[0, 1].map((index) => (
              <div key={`projects-skeleton-${index}`} className="h-48 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="mt-4 grid gap-1 text-sm text-muted-foreground">
            <p>{t('public.emptyProjects')}</p>
            {projectsFailed ? <p role="alert">{t('public.projectsError')}</p> : null}
          </div>
        ) : (
          <ul className="mt-6 grid gap-6 sm:grid-cols-2">
            {projects.map((project) => {
              // FE-14: status je bio sirov enum kad projekat nema lokaciju.
              const status = projectStatus(project.status)
              const statusLabel = t(status.labelKey, { defaultValue: project.status })
              return (
                <li key={project.id} className="overflow-hidden rounded-lg bg-card">
                  {project.coverAssetId ? (
                    <img
                      src={publicAssetUrl(project.coverAssetId)}
                      alt=""
                      width={640}
                      height={360}
                      loading="lazy"
                      decoding="async"
                      className="h-40 w-full object-cover"
                    />
                  ) : (
                    <div className="h-40 bg-secondary" aria-hidden="true" />
                  )}
                  <div className="p-4">
                    <p className="font-medium">{project.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {project.locality ? `${project.locality} · ${statusLabel}` : statusLabel}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <section className="mx-auto max-w-5xl px-6 pb-20" aria-labelledby="contact">
        <h2 id="contact" className="text-xl font-medium">
          {t('public.contact')}
        </h2>
        {/* FE-14: telefon i e-mail su bili mrtav tekst — na mobilnom se ne mogu pozvati ni otvoriti. */}
        <div className="mt-4 grid gap-1 text-sm text-muted-foreground">
          {company.phone ? (
            <p>
              {t('public.phone')}:{' '}
              <a className="underline-offset-4 hover:underline" href={`tel:${company.phone.replace(/[^\d+]/g, '')}`}>
                {company.phone}
              </a>
            </p>
          ) : null}
          {company.contact ? (
            <p>
              {EMAIL_PATTERN.test(company.contact) ? (
                <a className="underline-offset-4 hover:underline" href={`mailto:${company.contact}`}>
                  {company.contact}
                </a>
              ) : (
                company.contact
              )}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  )
}
