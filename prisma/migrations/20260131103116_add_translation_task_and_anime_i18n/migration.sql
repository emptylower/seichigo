-- CreateTable
CREATE TABLE "TranslationTask" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceContent" JSONB,
    "draftContent" JSONB,
    "finalContent" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationTask_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Anime" ADD COLUMN     "name_en" TEXT,
ADD COLUMN     "name_ja" TEXT,
ADD COLUMN     "summary_en" TEXT,
ADD COLUMN     "summary_ja" TEXT;

-- CreateIndex
CREATE INDEX "TranslationTask_status_idx" ON "TranslationTask"("status");

-- CreateIndex
CREATE INDEX "TranslationTask_entityType_status_idx" ON "TranslationTask"("entityType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationTask_entityType_entityId_targetLanguage_key" ON "TranslationTask"("entityType", "entityId", "targetLanguage");
