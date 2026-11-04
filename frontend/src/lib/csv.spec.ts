import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadCsv } from '@/lib/csv'

/**
 * FE-15 — izvoz u CSV. Drži tri stvari koje su korisnici osjetili: `č/ć/ž/š/đ` su u Excelu izlazili
 * kao smeće (nema UTF-8 BOM-a), redovi su bili spojeni sa `\n` umjesto `\r\n`, a ćelija koja počinje sa
 * `=`, `+`, `-` ili `@` izvršavala se kao **formula** (CSV injection). Link mora biti u dokumentu —
 * Safari inače ignoriše `click()`.
 */
const createObjectURL = vi.fn(() => 'blob:test')
const revokeObjectURL = vi.fn()
let clicked: HTMLAnchorElement | null = null
const written: Blob[] = []

function lastBlob(): Promise<string> {
  const blob = written.at(-1) as Blob
  return blob.text()
}

beforeEach(() => {
  written.length = 0
  clicked = null
  Object.assign(URL, { createObjectURL, revokeObjectURL })
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    written.push(blob as Blob)
    return 'blob:test'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked = this
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('downloadCsv', () => {
  it('dodaje UTF-8 BOM (Excel ne kvari naša slova)', async () => {
    downloadCsv('izvoz.csv', [['Naziv'], ['Čelična cijev']])

    // `blob.text()` sam odbaci BOM, pa se provjeravaju prva tri bajta (EF BB BF).
    const bytes = new Uint8Array(await (written.at(-1) as Blob).arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(await lastBlob()).toBe('"Naziv"\r\n"Čelična cijev"')
  })

  it('eskepuje navodnike i spaja redove sa CRLF', async () => {
    downloadCsv('a.csv', [['a"b', 'c,d'], ['1', '2']])

    expect(await lastBlob()).toBe('"a""b","c,d"\r\n"1","2"')
  })

  it('ćelije koje počinju formulom dobijaju apostrof (CSV injection)', async () => {
    downloadCsv('a.csv', [['=HYPERLINK("http://zlo","klik")'], ['+1'], ['-2'], ['@sum'], ['normalno']])

    const content = await lastBlob()
    expect(content).toContain(`"'=HYPERLINK(""http://zlo"",""klik"")"`)
    expect(content).toContain(`"'+1"`)
    expect(content).toContain(`"'-2"`)
    expect(content).toContain(`"'@sum"`)
    expect(content).toContain('"normalno"')
  })

  it('link je u dokumentu tokom klika (Safari), pa se uklanja; URL se oslobađa', () => {
    downloadCsv('izvoz.csv', [['x']])

    expect(clicked).not.toBeNull()
    expect(clicked?.download).toBe('izvoz.csv')
    expect(clicked?.isConnected).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })
})
