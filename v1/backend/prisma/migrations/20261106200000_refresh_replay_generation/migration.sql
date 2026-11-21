ALTER TABLE "RefreshToken" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "RefreshToken_userId_lineageKey_generation_idx" ON "RefreshToken"("userId", "lineageKey", "generation");
