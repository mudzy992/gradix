import Link from "next/link";
import { Alert } from "@/components/ui/index";
import type { PayrollReminder } from "@/server/payroll-reminder";

/**
 * Podsjetnik na `/pregled`: prethodni mjesec nije zaključan (F6, spec 07 §4).
 *
 * Kartica postoji SAMO kad podsjetnik treba — prazna kartica bi tvrdila da je sve zaključano,
 * a to je izjava koju ovaj ekran ne može dati bez perioda. Pojavljuje se poslije 5. u mjesecu;
 * ranije je otvoren period normalno stanje, ne propust.
 */
export function PayrollReminderCard({ reminder }: { reminder: PayrollReminder }) {
  return (
    <Alert tone="warning" role="status">
      <strong>Obračun: {reminder.message}</strong>{" "}
      <Link className="gx-link" href={`/ured/obracun-sati?godina=${reminder.year}`}>
        Otvori obračun →
      </Link>
    </Alert>
  );
}
