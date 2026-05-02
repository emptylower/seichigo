CREATE TABLE "MapImageDiagSession" (
    "id" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "surface" TEXT NOT NULL DEFAULT 'unknown',
    "sampled" BOOLEAN NOT NULL DEFAULT false,
    "escalationReason" TEXT,
    "routeContext" JSONB,
    "sessionOutcome" TEXT,
    "firstViewSummary" JSONB,
    "firstDegradedStage" TEXT,
    "firstDegradedAt" TIMESTAMP(3),
    "lastTerminalState" TEXT,
    "proxyInvolved" BOOLEAN NOT NULL DEFAULT false,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapImageDiagSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MapImageDiagEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "sessionRefId" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "slotKey" TEXT,
    "surface" TEXT,
    "slotType" TEXT,
    "owner" TEXT,
    "stage" TEXT NOT NULL,
    "outcome" TEXT,
    "terminalState" TEXT,
    "displayOutcome" TEXT,
    "durationMs" INTEGER,
    "severity" TEXT,
    "attemptIndex" INTEGER,
    "candidateIndex" INTEGER,
    "candidateCount" INTEGER,
    "requestedCandidateUrl" TEXT,
    "finalUrl" TEXT,
    "proxyJoinValue" TEXT,
    "targetHostBucket" TEXT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MapImageDiagEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MapImageDiagSession_sessionKey_key" ON "MapImageDiagSession"("sessionKey");
CREATE INDEX "MapImageDiagSession_createdAt_surface_idx" ON "MapImageDiagSession"("createdAt", "surface");
CREATE INDEX "MapImageDiagSession_surface_sessionOutcome_createdAt_idx" ON "MapImageDiagSession"("surface", "sessionOutcome", "createdAt");

CREATE UNIQUE INDEX "MapImageDiagEvent_eventKey_key" ON "MapImageDiagEvent"("eventKey");
CREATE INDEX "MapImageDiagEvent_sessionRefId_createdAt_idx" ON "MapImageDiagEvent"("sessionRefId", "createdAt");
CREATE INDEX "MapImageDiagEvent_sessionRefId_chainId_requestId_createdAt_idx" ON "MapImageDiagEvent"("sessionRefId", "chainId", "requestId", "createdAt");
CREATE INDEX "MapImageDiagEvent_sessionRefId_stage_createdAt_idx" ON "MapImageDiagEvent"("sessionRefId", "stage", "createdAt");

ALTER TABLE "MapImageDiagEvent"
ADD CONSTRAINT "MapImageDiagEvent_sessionRefId_fkey"
FOREIGN KEY ("sessionRefId") REFERENCES "MapImageDiagSession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
