-- CreateTable (第七轮 A1：plan agent 运行期实况，刷新恢复用)
CREATE TABLE "public"."TripPlanRunLive" (
    "planId" TEXT NOT NULL,
    "runToken" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "statusText" TEXT,
    "toolCalls" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripPlanRunLive_pkey" PRIMARY KEY ("planId")
);

-- planId 即主键，无需额外索引（与 schema 一致）

-- AddForeignKey
ALTER TABLE "public"."TripPlanRunLive" ADD CONSTRAINT "TripPlanRunLive_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."TripPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable (第七轮 A4：供应商接口地址，归一前的用户输入)
ALTER TABLE "public"."LlmProvider" ADD COLUMN "baseUrl" TEXT;
