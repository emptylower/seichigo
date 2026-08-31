-- CreateTable
CREATE TABLE "public"."TripPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startDate" TIMESTAMP(3),
    "dayCount" INTEGER NOT NULL DEFAULT 1,
    "bangumiIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "preferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TripPlanDay" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "date" TIMESTAMP(3),
    "citySlug" TEXT,
    "summary" TEXT,

    CONSTRAINT "TripPlanDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TripPlanItem" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "pointId" TEXT,
    "timeHint" TEXT,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "reason" TEXT,
    "payload" JSONB,

    CONSTRAINT "TripPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TripPlanMessage" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripPlanMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripPlan_userId_idx" ON "public"."TripPlan"("userId");

-- CreateIndex
CREATE INDEX "TripPlan_status_idx" ON "public"."TripPlan"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TripPlanDay_planId_dayIndex_key" ON "public"."TripPlanDay"("planId", "dayIndex");

-- CreateIndex
CREATE INDEX "TripPlanItem_dayId_idx" ON "public"."TripPlanItem"("dayId");

-- CreateIndex
CREATE INDEX "TripPlanItem_pointId_idx" ON "public"."TripPlanItem"("pointId");

-- CreateIndex
CREATE INDEX "TripPlanMessage_planId_createdAt_idx" ON "public"."TripPlanMessage"("planId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."TripPlan" ADD CONSTRAINT "TripPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripPlanDay" ADD CONSTRAINT "TripPlanDay_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."TripPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripPlanItem" ADD CONSTRAINT "TripPlanItem_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "public"."TripPlanDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripPlanItem" ADD CONSTRAINT "TripPlanItem_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "public"."AnitabiPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TripPlanMessage" ADD CONSTRAINT "TripPlanMessage_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."TripPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

