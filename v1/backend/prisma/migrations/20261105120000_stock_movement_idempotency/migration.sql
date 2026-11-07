-- Legacy movements retain NULL keys; PostgreSQL permits multiple NULLs.
ALTER TABLE "StockMovement" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "requestFingerprint" TEXT;
CREATE UNIQUE INDEX "StockMovement_companyId_idempotencyKey_key"
  ON "StockMovement"("companyId", "idempotencyKey");
