export function reviewLabel(row: { unknown_end: number; open_entries: number }): string | null {
  if (row.open_entries > 0) return "Za provjeru — otvoren segment";
  if (row.unknown_end > 0) return "Za provjeru — kraj nepoznat";
  return null;
}
