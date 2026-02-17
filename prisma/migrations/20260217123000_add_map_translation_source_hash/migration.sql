-- AlterTable
ALTER TABLE "TranslationTask"
  ADD COLUMN "sourceHash" TEXT;

ALTER TABLE "AnitabiBangumiI18n"
  ADD COLUMN "sourceHash" TEXT;

ALTER TABLE "AnitabiPointI18n"
  ADD COLUMN "sourceHash" TEXT;

-- CreateIndex
CREATE INDEX "TranslationTask_entityType_targetLanguage_sourceHash_idx"
  ON "TranslationTask"("entityType", "targetLanguage", "sourceHash");

CREATE INDEX "AnitabiBangumiI18n_language_sourceHash_idx"
  ON "AnitabiBangumiI18n"("language", "sourceHash");

CREATE INDEX "AnitabiPointI18n_language_sourceHash_idx"
  ON "AnitabiPointI18n"("language", "sourceHash");
