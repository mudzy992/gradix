export function formatDateTime(
  iso: string,
  timeZone: string,
  dateFormat: string,
): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  )
  const date = dateFormat
    .replaceAll('dd', parts.day ?? '')
    .replaceAll('MM', parts.month ?? '')
    .replaceAll('yyyy', parts.year ?? '')
  return `${date} ${parts.hour ?? '00'}:${parts.minute ?? '00'}`
}
