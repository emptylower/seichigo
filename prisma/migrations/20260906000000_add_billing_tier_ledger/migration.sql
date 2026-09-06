-- AlterTable (2026-09-06 订阅分档：档位与计费周期)
ALTER TABLE "public"."User" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "public"."User" ADD COLUMN "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "public"."User" ADD COLUMN "periodEnd" TIMESTAMP(3);

-- CreateTable (用量账本)
CREATE TABLE "public"."UsageLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT,
    "runRef" TEXT,
    "kind" TEXT NOT NULL,
    "deltaMicros" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageLedger_userId_periodStart_idx" ON "public"."UsageLedger"("userId", "periodStart");
CREATE INDEX "UsageLedger_runRef_idx" ON "public"."UsageLedger"("runRef");

-- AddForeignKey
ALTER TABLE "public"."UsageLedger" ADD CONSTRAINT "UsageLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
