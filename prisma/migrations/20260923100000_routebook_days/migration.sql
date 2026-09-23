-- AlterTable
ALTER TABLE "public"."RouteBook" ADD COLUMN     "dayCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "startDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."RouteBookDay" (
    "id" TEXT NOT NULL,
    "routeBookId" TEXT NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "date" TIMESTAMP(3),
    "title" TEXT,
    "defaultTravelMode" TEXT NOT NULL DEFAULT 'transit',

    CONSTRAINT "RouteBookDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RouteBookItem" (
    "id" TEXT NOT NULL,
    "routeBookId" TEXT NOT NULL,
    "dayId" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "pointId" TEXT,
    "placeId" TEXT,
    "title" TEXT,
    "note" TEXT,
    "timeStart" TEXT,
    "timeEnd" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "icon" TEXT,
    "color" TEXT,
    "legMode" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteBookItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RouteBookPlace" (
    "id" TEXT NOT NULL,
    "routeBookId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteBookPlace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RouteBookLodging" (
    "id" TEXT NOT NULL,
    "routeBookId" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "fromDayIndex" INTEGER NOT NULL,
    "toDayIndex" INTEGER NOT NULL,
    "checkIn" TEXT,
    "checkOut" TEXT,
    "note" TEXT,

    CONSTRAINT "RouteBookLodging_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RouteLegCache" (
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteLegCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "RouteBookDay_routeBookId_dayIndex_key" ON "public"."RouteBookDay"("routeBookId", "dayIndex");

-- CreateIndex
CREATE INDEX "RouteBookItem_routeBookId_dayId_idx" ON "public"."RouteBookItem"("routeBookId", "dayId");

-- CreateIndex
CREATE INDEX "RouteBookItem_pointId_idx" ON "public"."RouteBookItem"("pointId");

-- CreateIndex
CREATE INDEX "RouteBookPlace_routeBookId_idx" ON "public"."RouteBookPlace"("routeBookId");

-- CreateIndex
CREATE INDEX "RouteBookLodging_routeBookId_idx" ON "public"."RouteBookLodging"("routeBookId");

-- CreateIndex
CREATE INDEX "RouteLegCache_expiresAt_idx" ON "public"."RouteLegCache"("expiresAt");

-- AddForeignKey
ALTER TABLE "public"."RouteBookDay" ADD CONSTRAINT "RouteBookDay_routeBookId_fkey" FOREIGN KEY ("routeBookId") REFERENCES "public"."RouteBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RouteBookItem" ADD CONSTRAINT "RouteBookItem_routeBookId_fkey" FOREIGN KEY ("routeBookId") REFERENCES "public"."RouteBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RouteBookItem" ADD CONSTRAINT "RouteBookItem_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "public"."RouteBookDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RouteBookItem" ADD CONSTRAINT "RouteBookItem_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "public"."AnitabiPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RouteBookItem" ADD CONSTRAINT "RouteBookItem_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "public"."RouteBookPlace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RouteBookPlace" ADD CONSTRAINT "RouteBookPlace_routeBookId_fkey" FOREIGN KEY ("routeBookId") REFERENCES "public"."RouteBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RouteBookLodging" ADD CONSTRAINT "RouteBookLodging_routeBookId_fkey" FOREIGN KEY ("routeBookId") REFERENCES "public"."RouteBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RouteBookLodging" ADD CONSTRAINT "RouteBookLodging_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "public"."RouteBookPlace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== 数据搬运（手写，追加在生成的 DDL 之后）=====
-- 1) startDate 回填（metadata.startDate 可解析时）
UPDATE "RouteBook" SET "startDate" = left(("metadata"->>'startDate'), 10)::date
WHERE "metadata" ? 'startDate'
  AND jsonb_typeof("metadata"->'startDate') = 'string'
  AND ("metadata"->>'startDate') ~ '^\d{4}-\d{2}-\d{2}';

-- 2) 旧导出写过 zone='Day N' 的本：dayCount = max(N)
UPDATE "RouteBook" rb SET "dayCount" = GREATEST(1, sub.maxn)
FROM (
  SELECT "routeBookId", MAX(substring("zone" from '^Day (\d+)$')::int) AS maxn
  FROM "RouteBookPoint" WHERE "zone" ~ '^Day \d+$' GROUP BY "routeBookId"
) sub WHERE sub."routeBookId" = rb."id";

-- 3) 每本建 Day 1..dayCount，date 由 startDate 派生
INSERT INTO "RouteBookDay" ("id","routeBookId","dayIndex","date")
SELECT 'rbd_' || md5(rb."id" || ':' || g.n), rb."id", g.n,
       CASE WHEN rb."startDate" IS NULL THEN NULL ELSE rb."startDate" + ((g.n - 1) || ' days')::interval END
FROM "RouteBook" rb CROSS JOIN LATERAL generate_series(1, rb."dayCount") AS g(n);

-- 4) sorted → Day 1；'Day N' → Day N；其余(unsorted) → 未安排。每天 sortOrder 重编
INSERT INTO "RouteBookItem" ("id","routeBookId","dayId","sortOrder","kind","pointId","createdAt")
SELECT 'rbi_' || md5(p."id"), p."routeBookId", d."id",
       (row_number() OVER (PARTITION BY p."routeBookId", d."id" ORDER BY p."sortOrder", p."createdAt")) - 1,
       'point', p."pointId", p."createdAt"
FROM "RouteBookPoint" p
LEFT JOIN "RouteBookDay" d ON d."routeBookId" = p."routeBookId"
  AND d."dayIndex" = CASE WHEN p."zone" = 'sorted' THEN 1
                          WHEN p."zone" ~ '^Day \d+$' THEN substring(p."zone" from '^Day (\d+)$')::int
                          ELSE NULL END;

