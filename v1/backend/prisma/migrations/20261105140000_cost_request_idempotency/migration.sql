-- Retry receipts are durable even when their cost is physically deleted.
CREATE TABLE "CostRequest" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "costEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CostRequest_companyId_idempotencyKey_key" ON "CostRequest"("companyId", "idempotencyKey");
CREATE UNIQUE INDEX "CostRequest_costEntryId_key" ON "CostRequest"("costEntryId");
ALTER TABLE "CostRequest" ADD CONSTRAINT "CostRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostRequest" ADD CONSTRAINT "CostRequest_costEntryId_fkey" FOREIGN KEY ("costEntryId") REFERENCES "CostEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
