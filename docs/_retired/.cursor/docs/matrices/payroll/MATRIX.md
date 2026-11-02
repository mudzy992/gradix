> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Payroll / timesheet — matrica

Status: **locked**. Šema hook Faza 2; UI/cron Faza 9.

- `User.hourlyRate` Decimal nullable (BAM / sat)
- `TimerSession.approvalStatus`: APPROVED (default do Faze 9) | PENDING | REJECTED
- Faza 9: novi sessioni PENDING; SS/PM approve na scoped projektu; ADMIN sve
- Izvještaj: zbroj APPROVED minuta × rate; export xlsx
- Nije: doprinosi, porez, bolovanje, prekovremeni koeficijent (kasnije polja, ne blok)
- `currentSpend` projekta **ne** uključuje payroll dok ERP CostEntry to ne uveze
- GPS/geofence **nije** uvjet ni dokaz odobrenja
- WORKER vidi svoju `hourlyRate`; tuđu ne
- Period izvještaja = kalendarski **mjesec** u `app.timezone` (ne UTC mjesec)
- Session ulazi u mjesec/dan po `startedAt` u TZ (cijeli duration, nema splita preko ponoći)
- Izvor minuta = `durationMinutes` (pause isključen; poslije TIMER amend = nova duration)
- SS **ne** odobrava vlastiti session → 403 `PAYROLL_SELF_APPROVE` (PM isto). ADMIN/SUPER_ADMIN smiju
- `payroll.write`: ADMIN i SUPER_ADMIN (PM/SS samo approve sessiona na scoped projektu, ne mijenjaju stope)
