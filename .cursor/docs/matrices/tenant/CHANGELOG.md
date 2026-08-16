# Changelog — tenant

## 2026-08-15 (Faza 3 lock)

- **Šta:** PATCH /api/company za ADMIN settings.write.
- **Zašto:** Pravna polja nisu platform-only.

## 2026-08-15 (Faza 1 lock)

- **Šta:** Locked; firstName/lastName; employeeCode; company.email; cuid.
- **Zašto:** Review Faze 1 — ime mora biti na Useru.

## 2026-08-15 (presence/reset)

- **Šta:** isActive=false blokira login firme.
- **Zašto:** Drugi sloj freeze prijedloga.

## 2026-08-15 (peglanje)

- **Šta:** Pravna polja firme; mustChangePassword; locale.
- **Zašto:** Public/payroll/onboarding bez nagađanja.

## 2026-08-15 (freeze)

- **Šta:** Slug regex + immutable; email deaktiviran zauzet.
- **Zašto:** Planning freeze.

## 2026-08-14

- **Šta:** Company + companyId; PLATFORM_ADMIN; seed demo.
- **Zašto:** Multi-firma od Faze 1 da nema kasnijeg rewrite-a.
