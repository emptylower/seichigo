-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name_zh" TEXT NOT NULL,
    "name_en" TEXT,
    "name_ja" TEXT,
    "description_zh" TEXT,
    "description_en" TEXT,
    "transportTips_zh" TEXT,
    "transportTips_en" TEXT,
    "cover" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT true,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CityAlias" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "aliasNorm" TEXT NOT NULL,
    "langCode" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CityAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CityRedirect" (
    "fromSlug" TEXT NOT NULL,
    "toCityId" TEXT NOT NULL,

    CONSTRAINT "CityRedirect_pkey" PRIMARY KEY ("fromSlug")
);

-- CreateTable
CREATE TABLE "ArticleCity" (
    "articleId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,

    CONSTRAINT "ArticleCity_pkey" PRIMARY KEY ("articleId","cityId")
);

-- CreateTable
CREATE TABLE "ArticleRevisionCity" (
    "revisionId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,

    CONSTRAINT "ArticleRevisionCity_pkey" PRIMARY KEY ("revisionId","cityId")
);

-- CreateTable
CREATE TABLE "SubmissionCity" (
    "submissionId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,

    CONSTRAINT "SubmissionCity_pkey" PRIMARY KEY ("submissionId","cityId")
);

-- CreateIndex
CREATE UNIQUE INDEX "City_slug_key" ON "City"("slug");

-- CreateIndex
CREATE INDEX "CityAlias_aliasNorm_idx" ON "CityAlias"("aliasNorm");

-- CreateIndex
CREATE INDEX "CityAlias_cityId_idx" ON "CityAlias"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "CityAlias_aliasNorm_key" ON "CityAlias"("aliasNorm");

-- CreateIndex
CREATE INDEX "CityRedirect_toCityId_idx" ON "CityRedirect"("toCityId");

-- CreateIndex
CREATE INDEX "ArticleCity_cityId_idx" ON "ArticleCity"("cityId");

-- CreateIndex
CREATE INDEX "ArticleRevisionCity_cityId_idx" ON "ArticleRevisionCity"("cityId");

-- CreateIndex
CREATE INDEX "SubmissionCity_cityId_idx" ON "SubmissionCity"("cityId");

-- AddForeignKey
ALTER TABLE "CityAlias" ADD CONSTRAINT "CityAlias_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CityRedirect" ADD CONSTRAINT "CityRedirect_toCityId_fkey" FOREIGN KEY ("toCityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleCity" ADD CONSTRAINT "ArticleCity_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleCity" ADD CONSTRAINT "ArticleCity_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleRevisionCity" ADD CONSTRAINT "ArticleRevisionCity_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ArticleRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleRevisionCity" ADD CONSTRAINT "ArticleRevisionCity_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionCity" ADD CONSTRAINT "SubmissionCity_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionCity" ADD CONSTRAINT "SubmissionCity_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
