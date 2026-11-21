-- Existing documents have NULL keys, so this non-destructive migration preserves them.
-- PostgreSQL allows multiple NULLs in a unique index for legacy clients.
ALTER TABLE "ProjectDocument" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "ProjectDocument_projectId_idempotencyKey_key"
  ON "ProjectDocument"("projectId", "idempotencyKey");
