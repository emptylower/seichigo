CREATE TABLE "MapImageMirrorState" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "mirroredAt" TIMESTAMP(3),
    "contentBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapImageMirrorState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MapImageMirrorBootstrap" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "bangumiCursor" INTEGER,
    "pointCursor" TEXT,
    "bangumiCompleted" BOOLEAN NOT NULL DEFAULT false,
    "pointCompleted" BOOLEAN NOT NULL DEFAULT false,
    "totalEnumerated" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastAdvanceAt" TIMESTAMP(3),
    "manuallyTriggered" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MapImageMirrorBootstrap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MapImageMirrorState_sourceType_sourceId_variant_key" ON "MapImageMirrorState"("sourceType", "sourceId", "variant");
CREATE INDEX "MapImageMirrorState_status_createdAt_idx" ON "MapImageMirrorState"("status", "createdAt");
CREATE INDEX "MapImageMirrorState_status_lastAttemptAt_idx" ON "MapImageMirrorState"("status", "lastAttemptAt");
