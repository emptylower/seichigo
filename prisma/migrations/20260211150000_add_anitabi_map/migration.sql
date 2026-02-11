-- CreateTable
CREATE TABLE "AnitabiBangumi" (
  "id" INTEGER NOT NULL,
  "titleZh" TEXT,
  "titleJaRaw" TEXT,
  "cat" TEXT,
  "cover" TEXT,
  "description" TEXT,
  "color" TEXT,
  "city" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "geoLat" DOUBLE PRECISION,
  "geoLng" DOUBLE PRECISION,
  "zoom" DOUBLE PRECISION,
  "sourceModifiedMs" BIGINT,
  "mapEnabled" BOOLEAN NOT NULL DEFAULT true,
  "datasetVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AnitabiBangumi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnitabiPoint" (
  "id" TEXT NOT NULL,
  "bangumiId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "nameZh" TEXT,
  "geoLat" DOUBLE PRECISION,
  "geoLng" DOUBLE PRECISION,
  "ep" TEXT,
  "s" TEXT,
  "image" TEXT,
  "origin" TEXT,
  "originUrl" TEXT,
  "originLink" TEXT,
  "density" INTEGER,
  "mark" TEXT,
  "folder" TEXT,
  "uid" INTEGER,
  "reviewUid" INTEGER,
  "datasetVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AnitabiPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnitabiBangumiMeta" (
  "bangumiId" INTEGER NOT NULL,
  "pointsLength" INTEGER NOT NULL DEFAULT 0,
  "imagesLength" INTEGER NOT NULL DEFAULT 0,
  "themeJson" JSONB,
  "customEpNamesJson" JSONB,
  "logsJson" JSONB,
  "removedPointsJson" JSONB,
  "completenessJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AnitabiBangumiMeta_pkey" PRIMARY KEY ("bangumiId")
);

-- CreateTable
CREATE TABLE "AnitabiContributor" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "avatar" TEXT,
  "link" TEXT,
  "raw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AnitabiContributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnitabiChangelogEntry" (
  "id" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "linksJson" JSONB,
  "sourceHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AnitabiChangelogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnitabiFavorite" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "bangumiId" INTEGER,
  "pointId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AnitabiFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnitabiViewHistory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "bangumiId" INTEGER,
  "pointId" TEXT,
  "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AnitabiViewHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnitabiBangumiI18n" (
  "id" TEXT NOT NULL,
  "bangumiId" INTEGER NOT NULL,
  "language" TEXT NOT NULL,
  "title" TEXT,
  "description" TEXT,
  "city" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AnitabiBangumiI18n_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnitabiPointI18n" (
  "id" TEXT NOT NULL,
  "pointId" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "name" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AnitabiPointI18n_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnitabiMapping" (
  "id" TEXT NOT NULL,
  "bangumiId" INTEGER NOT NULL,
  "animeId" TEXT,
  "cityId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AnitabiMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnitabiSyncRun" (
  "id" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "changedCount" INTEGER NOT NULL DEFAULT 0,
  "errorSummary" TEXT,
  "sourceSnapshotHash" TEXT,
  "datasetVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AnitabiSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnitabiSourceCursor" (
  "sourceName" TEXT NOT NULL,
  "etag" TEXT,
  "lastModified" TEXT,
  "value" TEXT,
  "lastSuccessAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AnitabiSourceCursor_pkey" PRIMARY KEY ("sourceName")
);

-- CreateIndex
CREATE INDEX "AnitabiBangumi_updatedAt_idx" ON "AnitabiBangumi"("updatedAt");
CREATE INDEX "AnitabiBangumi_sourceModifiedMs_idx" ON "AnitabiBangumi"("sourceModifiedMs");
CREATE INDEX "AnitabiBangumi_datasetVersion_idx" ON "AnitabiBangumi"("datasetVersion");
CREATE INDEX "AnitabiBangumi_mapEnabled_updatedAt_idx" ON "AnitabiBangumi"("mapEnabled", "updatedAt");

CREATE INDEX "AnitabiPoint_bangumiId_updatedAt_idx" ON "AnitabiPoint"("bangumiId", "updatedAt");
CREATE INDEX "AnitabiPoint_bangumiId_ep_idx" ON "AnitabiPoint"("bangumiId", "ep");
CREATE INDEX "AnitabiPoint_datasetVersion_idx" ON "AnitabiPoint"("datasetVersion");
CREATE INDEX "AnitabiPoint_geoLat_geoLng_idx" ON "AnitabiPoint"("geoLat", "geoLng");

CREATE INDEX "AnitabiChangelogEntry_date_idx" ON "AnitabiChangelogEntry"("date");
CREATE INDEX "AnitabiChangelogEntry_sourceHash_idx" ON "AnitabiChangelogEntry"("sourceHash");

CREATE UNIQUE INDEX "AnitabiFavorite_userId_targetKey_key" ON "AnitabiFavorite"("userId", "targetKey");
CREATE INDEX "AnitabiFavorite_userId_createdAt_idx" ON "AnitabiFavorite"("userId", "createdAt");
CREATE INDEX "AnitabiFavorite_bangumiId_idx" ON "AnitabiFavorite"("bangumiId");
CREATE INDEX "AnitabiFavorite_pointId_idx" ON "AnitabiFavorite"("pointId");

CREATE INDEX "AnitabiViewHistory_userId_viewedAt_idx" ON "AnitabiViewHistory"("userId", "viewedAt");
CREATE INDEX "AnitabiViewHistory_targetKey_idx" ON "AnitabiViewHistory"("targetKey");
CREATE INDEX "AnitabiViewHistory_bangumiId_idx" ON "AnitabiViewHistory"("bangumiId");
CREATE INDEX "AnitabiViewHistory_pointId_idx" ON "AnitabiViewHistory"("pointId");

CREATE UNIQUE INDEX "AnitabiBangumiI18n_bangumiId_language_key" ON "AnitabiBangumiI18n"("bangumiId", "language");
CREATE INDEX "AnitabiBangumiI18n_language_updatedAt_idx" ON "AnitabiBangumiI18n"("language", "updatedAt");

CREATE UNIQUE INDEX "AnitabiPointI18n_pointId_language_key" ON "AnitabiPointI18n"("pointId", "language");
CREATE INDEX "AnitabiPointI18n_language_updatedAt_idx" ON "AnitabiPointI18n"("language", "updatedAt");

CREATE INDEX "AnitabiMapping_bangumiId_idx" ON "AnitabiMapping"("bangumiId");
CREATE INDEX "AnitabiMapping_animeId_idx" ON "AnitabiMapping"("animeId");
CREATE INDEX "AnitabiMapping_cityId_idx" ON "AnitabiMapping"("cityId");

CREATE INDEX "AnitabiSyncRun_createdAt_idx" ON "AnitabiSyncRun"("createdAt");
CREATE INDEX "AnitabiSyncRun_mode_status_startedAt_idx" ON "AnitabiSyncRun"("mode", "status", "startedAt");

-- AddForeignKey
ALTER TABLE "AnitabiPoint" ADD CONSTRAINT "AnitabiPoint_bangumiId_fkey"
  FOREIGN KEY ("bangumiId") REFERENCES "AnitabiBangumi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnitabiBangumiMeta" ADD CONSTRAINT "AnitabiBangumiMeta_bangumiId_fkey"
  FOREIGN KEY ("bangumiId") REFERENCES "AnitabiBangumi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnitabiFavorite" ADD CONSTRAINT "AnitabiFavorite_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnitabiFavorite" ADD CONSTRAINT "AnitabiFavorite_bangumiId_fkey"
  FOREIGN KEY ("bangumiId") REFERENCES "AnitabiBangumi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnitabiFavorite" ADD CONSTRAINT "AnitabiFavorite_pointId_fkey"
  FOREIGN KEY ("pointId") REFERENCES "AnitabiPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnitabiViewHistory" ADD CONSTRAINT "AnitabiViewHistory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnitabiViewHistory" ADD CONSTRAINT "AnitabiViewHistory_bangumiId_fkey"
  FOREIGN KEY ("bangumiId") REFERENCES "AnitabiBangumi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnitabiViewHistory" ADD CONSTRAINT "AnitabiViewHistory_pointId_fkey"
  FOREIGN KEY ("pointId") REFERENCES "AnitabiPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnitabiBangumiI18n" ADD CONSTRAINT "AnitabiBangumiI18n_bangumiId_fkey"
  FOREIGN KEY ("bangumiId") REFERENCES "AnitabiBangumi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnitabiPointI18n" ADD CONSTRAINT "AnitabiPointI18n_pointId_fkey"
  FOREIGN KEY ("pointId") REFERENCES "AnitabiPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnitabiMapping" ADD CONSTRAINT "AnitabiMapping_bangumiId_fkey"
  FOREIGN KEY ("bangumiId") REFERENCES "AnitabiBangumi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnitabiMapping" ADD CONSTRAINT "AnitabiMapping_animeId_fkey"
  FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnitabiMapping" ADD CONSTRAINT "AnitabiMapping_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;
