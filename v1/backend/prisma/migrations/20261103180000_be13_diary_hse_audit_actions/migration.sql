-- BE-13 (B11): audit akcije za dnevnik i HSE.
-- Do sada su izmjene dnevnika i HSE prijava bile jedine poslovne promjene bez traga.
-- `ALTER TYPE ... ADD VALUE` je dozvoljen unutar transakcije na PostgreSQL >= 12.

ALTER TYPE "AuditAction" ADD VALUE 'DIARY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'DIARY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'DIARY_PHOTO_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'DIARY_PDF_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'INCIDENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'INCIDENT_STATUS_CHANGED';
