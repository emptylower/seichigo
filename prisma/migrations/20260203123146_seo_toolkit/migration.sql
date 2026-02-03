-- CreateTable
CREATE TABLE "SeoKeyword" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoRankHistory" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "position" INTEGER,
    "url" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "SeoRankHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoGscData" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoGscData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoApiUsage" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoApiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeoRankHistory_keywordId_idx" ON "SeoRankHistory"("keywordId");

-- CreateIndex
CREATE UNIQUE INDEX "SeoGscData_query_page_date_key" ON "SeoGscData"("query", "page", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SeoApiUsage_provider_date_key" ON "SeoApiUsage"("provider", "date");

-- AddForeignKey
ALTER TABLE "SeoRankHistory" ADD CONSTRAINT "SeoRankHistory_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "SeoKeyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
