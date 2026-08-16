# Changelog — timer

## 2026-08-15 (Faze 4–6 lock)

- **Šta:** Offline push startedAt; machine mutex Faza 4; PENDING Faza 9.
- **Zašto:** Review faza 4–11.

## 2026-08-15 (Faza 2 lock)

- **Šta:** Close-while-pause formula; GET /timer?projectId=; PENDING start 409; mutex u migraciji.
- **Zašto:** Rupe Faze 2 (drugi sloj).

## 2026-08-15 (presence/reset)

- **Šta:** Payroll dan = startedAt TZ; Amendment duration.
- **Zašto:** Drugi sloj freeze prijedloga.

## 2026-08-15 (peglanje)

- **Šta:** Pause ne teče; auto-close 12h; terminal projekat; deaktivacija close.
- **Zašto:** Plate i sati mašine bez zaboravljenog timera.

## 2026-08-15 (freeze)

- **Šta:** IN_SERVICE blokira start; service force-close.
- **Zašto:** Planning freeze.

## 2026-08-15

- **Šta:** Mutex po mašini; sati mašine += duration; complete samo tasks.write; GPS nije payroll dokaz.
- **Zašto:** Dupli sati na istom bageru i lažni servis cron.
