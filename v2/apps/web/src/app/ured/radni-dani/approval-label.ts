/** R4b: oznake stanja odobrenja + ISO ponedjeljak (čisto, bez server importa u klijentu). */
export function weekStartFromWorkDate(workDate: string): string {
  const [y, m, d] = workDate.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  const isoDow = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() - (isoDow - 1));
  return utc.toISOString().slice(0, 10);
}

export function approvalLabel(status: string): string {
  if (status === "FOREMAN_CONFIRMED") return "Potvrđeno";
  if (status === "LOCKED") return "Zaključano";
  return "Čeka potvrdu";
}

export function weekStatusLabel(status: string | null | undefined): string {
  if (status === "WEEK_APPROVED") return "Sedmica odobrena";
  if (status === "WEEK_REJECTED") return "Sedmica odbijena";
  if (status === "LOCKED") return "Sedmica zaključana";
  if (status === "OPEN") return "Sedmica otvorena";
  return "Sedmica bez odluke";
}
