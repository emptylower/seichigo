-- CreateTable
CREATE TABLE "Anime" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alias" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "year" INTEGER,
    "summary" TEXT,
    "cover" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Anime_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Article" ADD COLUMN "animeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Data migration (best-effort)
UPDATE "Article" SET "animeIds" = ARRAY["animeId"] WHERE "animeId" IS NOT NULL;

-- DropColumn
ALTER TABLE "Article" DROP COLUMN "animeId";

