> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Auth — matrica

Status: **locked** (Faza 1). Izmjena = freeze.

## Tokeni

- Access JWT 15m: **samo `sub`**. Guard učitava user, company, role iz DB.
- `/me`: firstName, lastName, employeeCode, `roles[]`, `permissions[]`, `companyId`, `company: { id, name, slug } | null`, `hourlyRate` samo svoj, mustChangePassword, locale
- Refresh 30d, rotacija, **hash u DB**. Reuse već revokeanog/potrošenog refresh → revoke **svih** tokena tog usera
- Throttle login 5/min/IP + refresh 20/min/IP
- Web: remember-me localStorage vs sessionStorage
- Mobile: secure store

## Login

- email ili phone + password (phone nije OTP; SMS nema). Nepoznat nalog = ista `AUTH_INVALID_CREDENTIALS` kao loša lozinka
- Telefon: E.164 ili null (`AUTH_PHONE_INVALID`)
- Lozinka min 10; hash Argon2id (`AUTH_PASSWORD_TOO_SHORT`)
- Email unique uključuje deaktivirane (`AUTH_EMAIL_TAKEN` — nema reuse)
- `isActive=false` ili bez uloga → 401 `AUTH_ACCOUNT_INACTIVE` / `AUTH_INVALID_CREDENTIALS`
- Userove firme `Company.isActive=false` → 401 `AUTH_COMPANY_INACTIVE` (nije PLATFORM_ADMIN)
- `X-Company-Id`: **samo** PLATFORM_ADMIN; svaki drugi caller → 400 `TENANT_HEADER_FORBIDDEN`
- PLATFORM_ADMIN bez headera na tenant ruti → 403 `TENANT_HEADER_REQUIRED`
- Ostali: company sa usera, header se ne sluša
- Nema self-register
- API `POST /users`: temp lozinka **jednom** u `data.temporaryPassword`; `mustChangePassword=true`. GET/PATCH liste **nikad** lozinku.
- Seed useri: `mustChangePassword=false`
- Dok `mustChangePassword=true`: samo `GET /me`, `POST /auth/change-password`, logout(s); ostalo 403 `AUTH_PASSWORD_CHANGE_REQUIRED`
- `POST /api/auth/logout` = ovaj refresh; `POST /api/auth/logout-all` = svi
- `POST /api/auth/change-password` → `mustChangePassword=false` + revoke **svih** refresh (re-login)
- Deaktivacija: revoke all; force-close open timer **od Faze 2** (Faza 1 no-op)
- `POST /api/users/:id/reset-password` (`users.write`): nova temp jednom, mustChangePassword, revoke all. Zabranjen self. Audit `PASSWORD_RESET`.
- `PATCH /api/me`: firstName, lastName, locale (ne email, role, rate, employeeCode)
- `PATCH /api/company` (`settings.write`): name, legalName, address, city, country, taxId, phone, email, logoPath. Ne slug, ne isActive. PLATFORM_ADMIN i dalje `PATCH /companies/:id`

## Device

`Device`: userId, deviceId, fcmToken?, lastSeenAt. @@unique([userId, deviceId])

## Reset

Samo email kad `features.email=true`. Forgot/reset **uvijek 200** (nema enumeracije). Nema SMS. ADMIN reset (gore) radi i kad je email flag false.

## Socket

Server join `user:{id}` i `company:{id}` iz DB nakon handshake (**JWT u handshake auth**). Klijent emit `join` za tuđi room = ignore/disconnect.
