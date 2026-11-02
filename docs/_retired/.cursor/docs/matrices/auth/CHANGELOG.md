> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Changelog — auth

## 2026-08-15 (Faza 3 lock)

- **Šta:** `/me.company`; `PATCH /api/company` za settings.write.
- **Zašto:** ADMIN settings UI bez platform PATCH.

## 2026-08-15 (Faza 1 lock)

- **Šta:** Locked; ime na /me; refresh hash; throttle brojevi; forgot 200; timer close od Faze 2.
- **Zašto:** Review Faze 1 do max.

## 2026-08-15 (presence/reset)

- **Šta:** `AUTH_COMPANY_INACTIVE`; ADMIN reset-password.
- **Zašto:** Drugi sloj freeze prijedloga.

## 2026-08-15 (peglanje)

- **Šta:** Temp lozinka jednom; force change; deaktivacija gasi timer.
- **Zašto:** Ulaz na teren bez SMTP-a.

## 2026-08-15 (freeze)

- **Šta:** E.164; min 10 + Argon2id; email deaktiviran zauzet; logout vs logout-all; change-password revoke all; header 400/403 kodovi.
- **Zašto:** Planning freeze Faza 1 ugovor.

## 2026-08-15

- **Šta:** SMS van; X-Company-Id samo PLATFORM_ADMIN (400 inače); refresh reuse → revoke all; socket rooms server-side.
- **Zašto:** IDOR i session theft.
