-- AlterTable
ALTER TABLE "public"."TripPlan" ADD COLUMN "stage" TEXT;

-- CreateTable
CREATE TABLE "public"."TripPlanRunLog" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "runToken" TEXT,
    "turnIndex" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "enrichReport" JSONB,
    "gateReport" JSONB,
    "toolCalls" JSONB,
    "modelUsage" JSONB,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TripPlanRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripPlanRunLog_planId_createdAt_idx" ON "public"."TripPlanRunLog"("planId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."TripPlanRunLog" ADD CONSTRAINT "TripPlanRunLog_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."TripPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
