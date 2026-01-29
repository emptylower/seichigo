-- AlterTable: Add language and translationGroupId to Article
ALTER TABLE "Article" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'zh';
ALTER TABLE "Article" ADD COLUMN "translationGroupId" TEXT;

-- AlterTable: Add language and translationGroupId to ArticleRevision
ALTER TABLE "ArticleRevision" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'zh';
ALTER TABLE "ArticleRevision" ADD COLUMN "translationGroupId" TEXT;

-- DropIndex: Remove unique constraint on slug alone
DROP INDEX "Article_slug_key";

-- CreateIndex: Add composite unique constraint on slug + language
CREATE UNIQUE INDEX "Article_slug_language_key" ON "Article"("slug" ASC, "language" ASC);

-- CreateIndex: Add index on translationGroupId for Article
CREATE INDEX "Article_translationGroupId_idx" ON "Article"("translationGroupId" ASC);

-- CreateIndex: Add index on translationGroupId for ArticleRevision
CREATE INDEX "ArticleRevision_translationGroupId_idx" ON "ArticleRevision"("translationGroupId" ASC);
