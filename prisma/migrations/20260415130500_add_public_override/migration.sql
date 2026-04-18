-- CreateTable
CREATE TABLE "PublicOverride" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "locale" TEXT,
    "action" TEXT NOT NULL,
    "redirectUrl" TEXT,
    "title" TEXT,
    "bodyText" TEXT,
    "ctaLabel" TEXT,
    "ctaHref" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rollbackSnapshotVersion" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicOverride_targetType_targetKey_locale_expiresAt_idx" ON "PublicOverride"("targetType", "targetKey", "locale", "expiresAt");

-- CreateIndex
CREATE INDEX "PublicOverride_expiresAt_idx" ON "PublicOverride"("expiresAt");

-- CreateIndex
CREATE INDEX "PublicOverride_createdById_idx" ON "PublicOverride"("createdById");

-- AddForeignKey
ALTER TABLE "PublicOverride" ADD CONSTRAINT "PublicOverride_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
