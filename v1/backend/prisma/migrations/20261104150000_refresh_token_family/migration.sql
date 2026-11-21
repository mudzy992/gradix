-- Nullable preserves all existing tokens and allows older app instances to
-- continue inserting rows during a rolling deployment. New code establishes
-- a family lazily when an old token is rotated.
ALTER TABLE "RefreshToken" ADD COLUMN "lineageKey" TEXT;
CREATE INDEX "RefreshToken_userId_lineageKey_idx" ON "RefreshToken"("userId", "lineageKey");
