-- CreateTable
CREATE TABLE "TranslationHistory" (
    "id" TEXT NOT NULL,
    "translationTaskId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "TranslationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranslationHistory_translationTaskId_idx" ON "TranslationHistory"("translationTaskId");

-- CreateIndex
CREATE INDEX "TranslationHistory_articleId_idx" ON "TranslationHistory"("articleId");

-- CreateIndex
CREATE INDEX "TranslationHistory_createdAt_idx" ON "TranslationHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "TranslationHistory" ADD CONSTRAINT "TranslationHistory_translationTaskId_fkey" FOREIGN KEY ("translationTaskId") REFERENCES "TranslationTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationHistory" ADD CONSTRAINT "TranslationHistory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
