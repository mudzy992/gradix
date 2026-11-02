# Changelog — payroll

## 2026-08-16 (Faza 9 kod)

- **Šta:** Novi TimerSession insert `PENDING` (DB default ostaje APPROVED). TIMER amend APPROVED → PENDING.
- **Zašto:** Faza 9 izvršena.

## 2026-08-15 (presence/reset)

- **Šta:** Dan/mjesec po startedAt TZ; amend duration ulazi u zbroj.
- **Zašto:** Drugi sloj freeze prijedloga.

## 2026-08-15 (peglanje)

- **Šta:** Payroll koristi duration bez pause.
- **Zašto:** Usklađeno s timer matricom.

## 2026-08-15 (freeze)

- **Šta:** Mjesec u TZ firme; SS/PM ne odobravaju sebe.
- **Zašto:** Planning freeze.

## 2026-08-15

- **Šta:** GPS nije dokaz; vlastita stopa vidljiva; ADMIN payroll.write.
- **Zašto:** Kontrola sati = odobrenje, ne lokacija.
