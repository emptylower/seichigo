-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "lastApprovedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ArticleRevision" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "animeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "city" TEXT,
    "routeLength" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "cover" TEXT,
    "contentJson" JSONB,
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "activeKey" TEXT,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArticleRevision_articleId_idx" ON "ArticleRevision"("articleId");

-- CreateIndex
CREATE INDEX "ArticleRevision_authorId_idx" ON "ArticleRevision"("authorId");

-- CreateIndex
CREATE INDEX "ArticleRevision_status_idx" ON "ArticleRevision"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleRevision_articleId_activeKey_key" ON "ArticleRevision"("articleId", "activeKey");

-- AddForeignKey
ALTER TABLE "ArticleRevision" ADD CONSTRAINT "ArticleRevision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleRevision" ADD CONSTRAINT "ArticleRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

