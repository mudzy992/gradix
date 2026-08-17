export function downloadCsv(filename: string, rows: string[][]): void {
  const escape = (cell: string) => `"${cell.replaceAll('"', '""')}"`
  const blob = new Blob([rows.map((row) => row.map(escape).join(',')).join('\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
