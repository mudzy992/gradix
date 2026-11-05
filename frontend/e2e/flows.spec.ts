import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { BrowserContext, Page } from '@playwright/test'
import { openSession, waitForAuthenticatedShell } from './session'

/**
 * FE-06 — admin tok na **stvarnom** backendu (seed `SEED_DEMO=true`).
 *
 * Jedna prijava po fajlu (`e2e/session.ts`) — backend rotira refresh token i reuse tretira kao krađu,
 * pa bi `storageState` po testu odjavio sve sesije (F-FE-06-06).
 * Unit testovi (FE-05) drže logiku; ovdje se provjerava da se ekrani zaista povezuju: dashboard →
 * prečica → lista → detalj, da navigacija označava aktivnu stranicu i da reflow radi na 320 px.
 * Podaci su iz `prisma/seed-demo-ops.ts` (`Sarajevo obilaznica`, faze `Zemljani radovi`/`Asfalt`,
 * zadatak `Iskop kanala`).
 */
const ADMIN = {
  email: process.env.E2E_LOGIN_EMAIL ?? '',
  password: process.env.E2E_LOGIN_PASSWORD ?? '',
}

/**
 * FE-11: kad API vrati grešku (npr. 429 zbog limita), ekran prikaže `role="alert"` umjesto podataka i
 * test padne na „element nije nađen“ — poruka tada ne kaže šta se stvarno dogodilo. Ovaj pomoćnik
 * pretvara to stanje u jasnu grešku sa tekstom ekrana.
 */
async function expectNoLoadError(target: Page) {
  const alert = target.getByRole('alert')
  if ((await alert.count()) > 0) {
    throw new Error(`Ekran prikazuje grešku umjesto podataka: ${(await alert.first().innerText()).trim()}`)
  }
}

let context: BrowserContext
let page: Page

test.describe('FE-06 — admin tok', () => {
  test.beforeAll(async ({ browser }) => {
    if (!ADMIN.email || !ADMIN.password) {
      test.skip(true, 'E2E login kredencijali nisu postavljeni')
      return
    }
    ;({ context, page } = await openSession(browser, ADMIN.email, ADMIN.password))
  })

  test.afterAll(async () => {
    await context?.close()
  })

  test.beforeEach(async () => {
    await page.goto('/dashboard')
    // URL alone appears before bootstrap finishes; do not abort an in-flight rotation.
    await waitForAuthenticatedShell(page)
  })

  test('dashboard je prvi ekran poslije prijave i ima prevedene kartice', async () => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/dashboard/i)
    await expect(page.getByRole('heading', { name: /ključni pokazatelji/i })).toHaveCount(1)

    // Kartice po roli (SUPER_ADMIN → admin bucket): barem jedna poznata labela.
    await expect(page.getByText('Aktivni projekti')).toBeVisible({ timeout: 15_000 })

    // Regresija (FE-04/FE-05): nijedan sirovi `dash.` ključ ne smije doći do ekrana.
    await expect(page.getByText(/dash\./)).toHaveCount(0)
  })

  test('prečica vodi na projekte, red otvara detalj sa fazama', async () => {
    // Prečica (zona B), ne sidebar — ista prava, drugi put do ekrana.
    const quick = page.getByRole('region', { name: /brze akcije/i })
    await quick.getByRole('link', { name: 'Projekti' }).click()
    await expect(page).toHaveURL(/\/projects$/)

    const project = page.getByRole('link', { name: 'Sarajevo obilaznica' })
    await expect(project).toBeVisible({ timeout: 15_000 })
    await expectNoLoadError(page)
    await project.click()

    await expect(page).toHaveURL(/\/projects\/[0-9a-z]{20,}$/i) // CUID, ne UUID
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/sarajevo obilaznica/i)

    // Faze iz seed-a su na tabu „Faze".
    await page.getByRole('tab', { name: 'Faze' }).click()
    await expect(page.getByText('Zemljani radovi')).toBeVisible({ timeout: 15_000 })
  })

  test('zadatak iz seed-a se otvara sa svojim naslovom', async () => {
    await page.goto('/tasks')
    const task = page.getByRole('link', { name: /Iskop kanala/ })
    await expect(task).toBeVisible({ timeout: 15_000 })
    await task.click()

    await expect(page).toHaveURL(/\/tasks\/[0-9a-z]{20,}$/i) // CUID, ne UUID
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/iskop kanala/i)
  })

  test('lista projekata prikazuje preveden status (FE-08)', async () => {
    await page.goto('/projects')
    const row = page.getByRole('row').filter({ hasText: 'Sarajevo obilaznica' })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expectNoLoadError(page)
    // Seedov projekat nema eksplicitan status → šema daje `PLANNING` ⇒ prikaz je „U planu“.
    await expect(row).toContainText('U planu')
    // Nijedan sirov enum se ne smije prikazati korisniku.
    await expect(page.getByText(/^(PLANNING|IN_PROGRESS|ON_HOLD|COMPLETED|CANCELLED)$/)).toHaveCount(0)
  })

  test('tabla zadataka ima prevedene kolone i broj po koloni', async () => {
    await page.goto('/tasks')
    await expect(page.getByText('Iskop kanala').first()).toBeVisible({ timeout: 15_000 })
    await expectNoLoadError(page)

    await expect(page.getByRole('region', { name: /^Dodijeljeno/ })).toBeVisible()
    await expect(page.getByRole('region', { name: /^Nedodijeljeno/ })).toBeVisible()
    // Sirovi enum se ne smije prikazati kao naslov kolone.
    await expect(page.getByRole('heading', { name: 'PENDING' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'IN_PROGRESS' })).toHaveCount(0)
  })

  test('flota prikazuje preveden tip i status mašine (FE-09)', async () => {
    await page.goto('/fleet')
    const row = page.getByRole('row').filter({ hasText: 'Kiper 1' })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expectNoLoadError(page)
    // Seed: `Kiper 1` je `TRUCK`, status iz šeme je `IDLE` ⇒ „Kamion“ i „Slobodna“.
    await expect(row).toContainText('Kamion')
    await expect(row).toContainText('Slobodna')
    await expect(page.getByText(/^(TRUCK|EXCAVATOR|IDLE|IN_SERVICE|DECOMMISSIONED)$/)).toHaveCount(0)
  })

  test('HSE ekran ima prevedeno prazno stanje, bez sirovih enuma (FE-10)', async () => {
    await page.goto('/hse')
    // U seed-u nema incidenata → prazno stanje mora biti jasno rečeno, ne prazna lista.
    await expect(page.getByText('Nema HSE prijava.')).toBeVisible({ timeout: 15_000 })
    await expectNoLoadError(page)
    await expect(page.getByText(/Prijavite incident ili opasnost/)).toBeVisible()
    await expect(page.getByText(/^(LOW|MEDIUM|HIGH|OPEN|ACK|CLOSED)$/)).toHaveCount(0)
  })

  test('tenderi imaju prevedene kolone i prazno stanje (FE-11)', async () => {
    await page.goto('/tenders')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/tenderi/i)
    await expectNoLoadError(page)
    // Kolone su faze tendera; seed nema tendera → svaka kolona to kaže.
    await expect(page.getByRole('region', { name: /^Nacrt/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('region', { name: /^Povučen/ })).toBeVisible()
    await expect(page.getByText('Nema tendera u ovoj fazi.').first()).toBeVisible()
    await expect(page.getByText(/^(DRAFT|SUBMITTED|WON|LOST|WITHDRAWN)$/)).toHaveCount(0)
  })

  test('obračun prikazuje sate i prevedene statuse, bez sirovih enuma (FE-12)', async () => {
    await page.goto('/payroll')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/obračun sati/i)
    await expectNoLoadError(page)
    // Ili zbroj za izabrani mjesec ili jasna poruka da nema stavki — nikad prazna stranica.
    await expect(page.getByText(/^(Zbroj za \d+\/\d+|Nema stavki obračuna za ovaj mjesec\.)$/).first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText(/^(PENDING|APPROVED|REJECTED)$/)).toHaveCount(0)
  })

  test('ERP otvara tabove i ne prikazuje sirove enume (FE-12)', async () => {
    await page.goto('/erp')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/erp-lite/i)
    await expectNoLoadError(page)
    // Prvi tab (partneri) je jedini koji se učitao — ostali nemaju zahtjev dok se ne otvore.
    await expect(page.getByRole('tab', { name: 'Partneri' })).toBeVisible({ timeout: 15_000 })
    // Troškovi: kategorija/izvor moraju biti prevedeni ili jasno prazni.
    await page.getByRole('tab', { name: 'Troškovi' }).click()
    await expect(page.getByText(/^(Nema troškova u ovom periodu\.|Troškova: \d+)$/)).toBeVisible({ timeout: 15_000 })
    await expectNoLoadError(page)
    // Lager: bez skladišta forma se ne nudi, nego se kaže šta nedostaje.
    await page.getByRole('tab', { name: 'Lager' }).click()
    await expect(
      page.getByText(/^(Nema skladišta — dodajte prvo skladište\.|Stavki lagera: \d+|Lager je prazan\.)$/),
    ).toBeVisible({ timeout: 15_000 })
    await expectNoLoadError(page)
    await expect(page.getByText(/^(CLIENT|SUPPLIER|SITE|YARD|CISTERN|MATERIAL|LABOR|PAYROLL|MANUAL)$/)).toHaveCount(0)
  })

  test('korisnici imaju status i oznaku sopstvenog naloga (FE-13)', async () => {
    await page.goto('/users')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/korisnici/i)
    await expectNoLoadError(page)
    await expect(page.getByRole('table')).toBeVisible({ timeout: 15_000 })
    // Zaglavlje statusa je ranije bilo prazno `<th>`; deaktiviran korisnik se nije razlikovao.
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
    // „Demo Admin“ postoji i u korisničkom meniju — provjerava se red u tabeli.
    await expect(page.getByRole('table').getByText('Demo Admin')).toBeVisible()
    await expect(page.getByText('(to ste vi)')).toBeVisible()
    await expect(page.getByText(/^(ACTIVE|INACTIVE)$/)).toHaveCount(0)
    // FE-16: široka tabela se skroluje — kontejner mora biti fokusabilan i imenovan, inače korisnik
    // koji ne koristi miš ne može doći do kolona van ekrana (WCAG 2.1.1).
    const scrollRegion = page.getByRole('region', { name: /korisnici/i })
    await expect(scrollRegion).toBeVisible()
    await expect(scrollRegion).toHaveAttribute('tabindex', '0')
    await scrollRegion.focus()
    await expect(scrollRegion).toBeFocused()
  })

  test('postavke: podaci firme i prevedene postavke (FE-13)', async () => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/postavke/i)
    await expectNoLoadError(page)
    // Forma firme postoji samo kad su podaci učitani (prije je prazna forma gazila podatke).
    await expect(page.getByLabel('Naziv').first()).toHaveValue('Demo Gradnja', { timeout: 15_000 })
    // Registar: labela je prevedena, opis sa backenda (engleski) se ne prikazuje.
    await expect(page.getByLabel('Valuta')).toBeVisible()
    await expect(page.getByText('Default currency code')).toHaveCount(0)
  })

  test('navigacija označava aktivnu stranicu (aria-current)', async () => {
    await page.goto('/projects')
    // Na desktopu je samo jedan `<nav>` u DOM-u (mobilni je u `Sheet`-u koji se ne montira).
    const active = page.locator('a[aria-current="page"]').first()
    await expect(active).toBeVisible()
    await expect(active).toHaveText(/projekti/i)
  })

  test('dashboard nema horizontalnog skrola na 320 px i ima jedno h1', async () => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
  test('lager: izgubljeni odgovor stvarnog servera i retry knjiže samo jedno kretanje', async () => {
    // Namjenski objekat ne dira postojeće zalihe; CI baza je seedovana demo baza.
    // Prefiks osigurava da se nađe među prvih 100 skladišta sortiranih po nazivu.
    const warehouseName = `! E2E retry ${randomUUID()}`
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/erp')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/erp-lite/i)
    await page.getByRole('tab', { name: 'Lager' }).click()
    await page.getByLabel('Naziv skladišta').fill(warehouseName)
    await page.getByRole('button', { name: 'Novo skladište' }).click()
    const warehouse = page.getByLabel('Skladište', { exact: true })
    await expect(warehouse.locator('option', { hasText: warehouseName })).toHaveCount(1, { timeout: 15_000 })
    await warehouse.selectOption({ label: warehouseName })
    await page.getByLabel('Materijal', { exact: true }).selectOption({ label: 'Šljunak' })
    const qty = page.getByLabel('Količina', { exact: true })
    await qty.fill('10')

    const attempts: Array<{ body: Record<string, unknown>; status: number; data: { id: string; qty: string } }> = []
    const pattern = '**/api/stock-movements'
    await page.route(pattern, async (route) => {
      const request = route.request()
      const response = await route.fetch({ maxRetries: 0 })
      const result = await response.json() as { data: { id: string; qty: string } }
      attempts.push({ body: request.postDataJSON() as Record<string, unknown>, status: response.status(), data: result.data })
      if (attempts.length === 1) {
        // Server je odgovorio nakon upisa, ali browser ne dobija odgovor.
        await route.abort('failed')
      } else {
        await route.fulfill({ response })
      }
    })
    try {
      await page.getByRole('button', { name: 'Knjiži' }).click()
      const unknown = page.getByRole('alert').filter({ hasText: 'Knjiženje nije potvrđeno' })
      await expect(unknown).toBeVisible()
      await expect(qty).toBeDisabled()
      await page.getByRole('button', { name: 'Razumijem, omogući novi pokušaj' }).click()
      await expect(qty).toBeDisabled()
      await page.getByRole('button', { name: 'Knjiži' }).click()
      await expect(qty).toHaveValue('')
      await expect(unknown).toHaveCount(0)

      expect(attempts).toHaveLength(2)
      expect(attempts.map((item) => item.status)).toEqual([201, 201])
      expect(attempts[0].body).toEqual(attempts[1].body)
      expect(attempts[0].body.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      expect(attempts[0].data.id).toBeTruthy()
      expect(attempts[1].data.id).toBe(attempts[0].data.id)
      expect(Number(attempts[0].data.qty)).toBe(10)
      const row = page.getByRole('listitem').filter({ hasText: `${warehouseName} · Šljunak` })
      await expect(row).toBeVisible()
      // Novo skladište nije imalo zalihe: zbir 10, ne 20, dodatno potvrđuje jedan upis.
      await expect(row.locator('span').last()).toHaveText('10')
    } finally {
      await page.unroute(pattern)
    }
  })

})
