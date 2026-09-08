-- CreateTable (2026-09-08 点位分享短链：ShareLink)
CREATE TABLE "public"."ShareLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'point',
    "pointId" TEXT NOT NULL,
    "bangumiId" INTEGER NOT NULL,
    "locale" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "imageKey" TEXT,
    "userId" TEXT,
    "ipHash" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_code_key" ON "public"."ShareLink"("code");
CREATE INDEX "ShareLink_pointId_idx" ON "public"."ShareLink"("pointId");
CREATE INDEX "ShareLink_userId_createdAt_idx" ON "public"."ShareLink"("userId", "createdAt");
CREATE INDEX "ShareLink_ipHash_createdAt_idx" ON "public"."ShareLink"("ipHash", "createdAt");
