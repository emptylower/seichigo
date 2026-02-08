-- CreateTable
CREATE TABLE "OpsReport" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "dateKey" TEXT NOT NULL,
    "triggerMode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalDeployments" INTEGER NOT NULL,
    "totalLogs" INTEGER NOT NULL,
    "severeCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "markdownSummary" TEXT NOT NULL,
    "rawSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsLogEvent" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3),
    "deploymentId" TEXT,
    "requestId" TEXT,
    "path" TEXT,
    "method" TEXT,
    "statusCode" INTEGER,
    "message" TEXT NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsLogEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpsReport_createdAt_dateKey_idx" ON "OpsReport"("createdAt", "dateKey");

-- CreateIndex
CREATE INDEX "OpsLogEvent_reportId_severity_timestamp_fingerprint_idx" ON "OpsLogEvent"("reportId", "severity", "timestamp", "fingerprint");

-- AddForeignKey
ALTER TABLE "OpsLogEvent" ADD CONSTRAINT "OpsLogEvent_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "OpsReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
