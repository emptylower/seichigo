-- CreateTable (2026-09-08 分享 v2 反向地理编码缓存：AnitabiPointAddress)
CREATE TABLE "public"."AnitabiPointAddress" (
    "pointId" TEXT NOT NULL,
    "addressZh" TEXT,
    "addressEn" TEXT,
    "addressJa" TEXT,
    "source" TEXT NOT NULL DEFAULT 'maptiler',
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnitabiPointAddress_pkey" PRIMARY KEY ("pointId")
);
