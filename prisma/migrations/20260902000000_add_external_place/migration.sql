-- CreateTable
CREATE TABLE "public"."ExternalPlace" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "placeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "mapsUri" TEXT NOT NULL,
    "photoReference" TEXT,
    "photoAttribution" TEXT,
    "photoMirrorKey" TEXT,
    "photoMirrorStatus" TEXT NOT NULL DEFAULT 'none',
    "photoMirroredAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExternalPlace_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "public"."ExternalPlaceQuery" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "normalizedQuery" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExternalPlaceQuery_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "ExternalPlace_provider_placeId_key" ON "public"."ExternalPlace"("provider", "placeId");
CREATE UNIQUE INDEX "ExternalPlaceQuery_provider_normalizedQuery_key" ON "public"."ExternalPlaceQuery"("provider", "normalizedQuery");
CREATE INDEX "ExternalPlaceQuery_provider_placeId_idx" ON "public"."ExternalPlaceQuery"("provider", "placeId");
-- AddForeignKey
ALTER TABLE "public"."ExternalPlaceQuery" ADD CONSTRAINT "ExternalPlaceQuery_provider_placeId_fkey" FOREIGN KEY ("provider", "placeId") REFERENCES "public"."ExternalPlace"("provider", "placeId") ON DELETE CASCADE ON UPDATE CASCADE;
