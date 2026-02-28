-- AlterTable
ALTER TABLE "AnitabiBangumi" ADD COLUMN     "titleOriginal" TEXT,
ADD COLUMN     "titleRomaji" TEXT,
ADD COLUMN     "titleEnglish" TEXT,
ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "anilistId" INTEGER,
ADD COLUMN     "anilistMatchConfidence" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "SearchQueryCache" (
    "id" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "queryLanguage" TEXT,
    "translatedZh" TEXT,
    "translatedEn" TEXT,
    "translatedJa" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchQueryCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SearchQueryCache_queryText_key" ON "SearchQueryCache"("queryText");

-- CreateIndex
CREATE INDEX "SearchQueryCache_createdAt_idx" ON "SearchQueryCache"("createdAt");

-- CreateIndex
CREATE INDEX "AnitabiBangumi_titleOriginal_idx" ON "AnitabiBangumi"("titleOriginal");

-- CreateIndex
CREATE INDEX "AnitabiBangumi_titleRomaji_idx" ON "AnitabiBangumi"("titleRomaji");

-- CreateIndex
CREATE INDEX "AnitabiBangumi_titleEnglish_idx" ON "AnitabiBangumi"("titleEnglish");
