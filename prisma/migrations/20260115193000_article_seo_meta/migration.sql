-- Add SEO metadata fields for public rendering.

ALTER TABLE "Article" ADD COLUMN "seoTitle" TEXT;
ALTER TABLE "Article" ADD COLUMN "description" TEXT;

ALTER TABLE "ArticleRevision" ADD COLUMN "seoTitle" TEXT;
ALTER TABLE "ArticleRevision" ADD COLUMN "description" TEXT;

