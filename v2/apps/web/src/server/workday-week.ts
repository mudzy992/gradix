/** ISO week start (Monday) from a business DATE string YYYY-MM-DD. */
export function weekStartFromWorkDate(workDate: string): string {
  const [y, m, d] = workDate.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  const isoDow = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay(); // Mon=1 … Sun=7
  utc.setUTCDate(utc.getUTCDate() - (isoDow - 1));
  return utc.toISOString().slice(0, 10);
}
