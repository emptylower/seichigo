ALTER TABLE "ExternalPlace" ADD COLUMN "photos" JSONB;
ALTER TABLE "AnitabiPoint" ADD COLUMN "googlePlaceId" TEXT;
ALTER TABLE "AnitabiPoint" ADD COLUMN "googlePlaceStatus" TEXT;
ALTER TABLE "AnitabiPoint" ADD COLUMN "googlePlaceResolvedAt" TIMESTAMP(3);
