-- CreateIndex
CREATE INDEX "Article_status_updatedAt_idx" ON "Article"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "ArticleRevision_status_updatedAt_idx" ON "ArticleRevision"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "TranslationTask_status_updatedAt_idx" ON "TranslationTask"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "TranslationTask_entityType_targetLanguage_status_updatedAt_idx" ON "TranslationTask"("entityType", "targetLanguage", "status", "updatedAt");
