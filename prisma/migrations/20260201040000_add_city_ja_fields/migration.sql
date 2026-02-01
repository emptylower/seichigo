-- AlterTable: Add Japanese language fields to City
ALTER TABLE "City" ADD COLUMN "description_ja" TEXT;
ALTER TABLE "City" ADD COLUMN "transportTips_ja" TEXT;
