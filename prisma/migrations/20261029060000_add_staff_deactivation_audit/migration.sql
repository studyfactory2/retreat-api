-- Preserve staff handover evidence separately from immutable submitted records.
CREATE TABLE "StaffDeactivation" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorSnapshot" JSONB NOT NULL,
    "staffSnapshot" JSONB NOT NULL,
    "assignments" JSONB NOT NULL,
    "revokedDraftCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffDeactivation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StaffDeactivation_revokedDraftCount_check" CHECK ("revokedDraftCount" >= 0)
);

CREATE INDEX "StaffDeactivation_staffUserId_createdAt_id_idx" ON "StaffDeactivation"("staffUserId", "createdAt", "id");
CREATE INDEX "StaffDeactivation_actorUserId_idx" ON "StaffDeactivation"("actorUserId");
ALTER TABLE "StaffDeactivation" ADD CONSTRAINT "StaffDeactivation_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffDeactivation" ADD CONSTRAINT "StaffDeactivation_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
