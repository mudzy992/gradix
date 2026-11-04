/** Ćelija koja počinje ovim znakovima Excel/LibreOffice izvršava kao **formulu** (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/

function escapeCell(cell: string): string {
  const safe = FORMULA_START.test(cell) ? `'${cell}` : cell
  return `"${safe.replaceAll('"', '""')}"`
}

/**
 * FE-15 — izvoz u CSV je imao tri problema: (1) ćelija koja počinje sa `=`, `+`, `-` ili `@` izvršavala
 * se kao formula u Excelu (CSV injection — npr. naziv firme `=HYPERLINK(...)`), (2) nije bilo UTF-8
 * BOM-a pa su `č/ć/ž/š/đ` u Excelu izlazili kao smeće, (3) redovi su spajani sa `\n` (Excel traži
 * `\r\n`), a link nije bio u dokumentu — Safari ga je ignorisao i preuzimanje je tiho izostalo.
 */
export function downloadCsv(filename: string, rows: string[][]): void {
  const content = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
