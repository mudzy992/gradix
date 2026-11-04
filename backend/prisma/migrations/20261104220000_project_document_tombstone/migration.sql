-- Keep document links and their retry keys after removal, without changing existing rows.
ALTER TABLE "ProjectDocument" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "ProjectDocument_projectId_deletedAt_idx"
  ON "ProjectDocument"("projectId", "deletedAt");
